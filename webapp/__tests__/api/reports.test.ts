jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { randomUUID } from "node:crypto";

import { getServerSession } from "next-auth";

import { prisma } from "../../lib/prisma";
import { processLateReportNotifications } from "../../lib/worker/notifications";
import { settleApprovedReport } from "../../lib/reports/settlement-seam";
import { POST as submitReportRoute } from "../../app/api/sessions/[id]/students/[studentId]/report/route";
import { POST as reviewReportRoute } from "../../app/api/reports/[id]/review/route";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

const getServerSessionMock = getServerSession as jest.Mock;

jest.setTimeout(180_000);

let fx: SessionFixtures;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function apiRequest(path: string, method: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function reportPayload(overrides: Record<string, unknown> = {}) {
  return {
    attendanceOutcome: "ATTENDED",
    classRemark: "good",
    summary: "Covered the lesson content.",
    homework: "Practice page 12.",
    notes: "",
    extraTimeMinutes: 0,
    ...overrides,
  };
}

async function submitReport(
  sessionId: string,
  studentId: string,
  actorId = fx.teacherUserId,
  payload: unknown = reportPayload(),
) {
  asActor(actorId);
  const response = await submitReportRoute(
    apiRequest(`/api/sessions/${sessionId}/students/${studentId}/report`, "POST", payload),
    { params: Promise.resolve({ id: sessionId, studentId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function reviewReport(reportId: string, action: "APPROVE" | "REJECT", actorId: string, reason?: string) {
  asActor(actorId);
  const response = await reviewReportRoute(
    apiRequest(`/api/reports/${reportId}/review`, "POST", { action, rejectionReason: reason }),
    { params: Promise.resolve({ id: reportId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function createPastSession(options: {
  studentProfileIds: string[];
  minutesAgoEnded?: number;
  status?: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "MISSED";
}) {
  const end = new Date(Date.now() - (options.minutesAgoEnded ?? 10) * 60 * 1000);
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  return prisma.session.create({
    data: {
      academyId: fx.academyId,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
      sessionType: options.studentProfileIds.length > 1 ? "GROUP" : "PRIVATE",
      scheduledStart: start,
      scheduledEnd: end,
      durationMinutes: 60,
      timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/345678901234",
      createdById: fx.adminUserId,
      status: options.status ?? "SCHEDULED",
      students: { create: options.studentProfileIds.map((studentId) => ({ studentId })) },
    },
    select: { id: true },
  });
}

async function grantCredit(studentProfileId: string, sessionsDelta: number) {
  const subscription = await prisma.subscription.create({
    data: {
      academyId: fx.academyId,
      studentId: studentProfileId,
      packageType: "MONTHLY_PLAN",
      sessionsPurchased: Math.max(sessionsDelta, 0),
      totalAmountMinor: BigInt(100000),
      currency: "EGP",
      status: "ACTIVE",
      periodStartsAt: new Date(Date.now() - 24 * 3600 * 1000),
      periodEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
    select: { id: true },
  });
  await prisma.subscriptionLedger.create({
    data: { academyId: fx.academyId, subscriptionId: subscription.id, entryType: "INITIAL_PURCHASE", sessionsDelta },
  });
}

beforeAll(async () => {
  process.env.MESSAGING_PROVIDER = "fake";
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Phase 5 — report submission and review (database-backed)", () => {
  it("rejects a submission before the scheduled end", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student1], minutesAgoEnded: -30 });
    const { status, body } = await submitReport(session.id, fx.studentProfileIds.student1);
    expect(status).toBe(409);
    expect(body.error.code).toBe("SESSION_NOT_FINISHED");
  });

  it("returns a generic 404 for an unassigned teacher and a foreign teacher", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student2] });
    const otherTeacher = await submitReport(session.id, fx.studentProfileIds.student2, fx.teacher2UserId);
    expect(otherTeacher.status).toBe(404);
    expect(otherTeacher.body.error.code).toBe("NOT_FOUND");
    const foreignTeacher = await submitReport(session.id, fx.studentProfileIds.student2, fx.foreignTeacherUserId);
    expect(foreignTeacher.status).toBe(404);
    expect(foreignTeacher.body.error.code).toBe("NOT_FOUND");
  });

  it("blocks reports for cancelled and missed sessions", async () => {
    const cancelled = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student3], status: "CANCELLED" });
    const cancelledResult = await submitReport(cancelled.id, fx.studentProfileIds.student3);
    expect(cancelledResult.status).toBe(409);
    expect(cancelledResult.body.error.code).toBe("SESSION_NOT_REPORTABLE");

    const missed = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student4], status: "MISSED" });
    const missedResult = await submitReport(missed.id, fx.studentProfileIds.student4);
    expect(missedResult.status).toBe(409);
    expect(missedResult.body.error.code).toBe("SESSION_NOT_REPORTABLE");
  });

  it("accepts a report for a completed (past) session and stores every field", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student5], status: "COMPLETED" });
    const { status, body } = await submitReport(session.id, fx.studentProfileIds.student5, fx.teacherUserId, reportPayload({
      extraTimeMinutes: 15,
      operationalEvents: { late_entry: 5 },
    }));
    expect(status).toBe(201);
    expect(body.data.status).toBe("SUBMITTED");
    expect(body.data.extraTimeStatus).toBe("PENDING");
    expect(body.data.operationalEvents).toEqual({ late_entry: 5 });
    const row = await prisma.report.findUniqueOrThrow({ where: { id: body.data.id } });
    expect(row.sessionId).toBe(session.id);
    expect(row.settledAt).toBeNull();
    expect(row.archivedAt).toBeNull();
  });

  it("requires homework and rejects an empty one with field errors", async () => {
    const { status, body } = await submitReport(randomUUID(), randomUUID(), fx.teacherUserId, reportPayload({ homework: "" }));
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.homework).toBeDefined();
  });

  it("answers a duplicate submission with ALREADY_SUBMITTED and blocks editing after approval with REPORT_IMMUTABLE", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student6] });
    const first = await submitReport(session.id, fx.studentProfileIds.student6);
    expect(first.status).toBe(201);
    const duplicate = await submitReport(session.id, fx.studentProfileIds.student6);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("ALREADY_SUBMITTED");

    const approved = await reviewReport(first.body.data.id, "APPROVE", fx.adminUserId);
    expect(approved.status).toBe(200);
    const afterApproval = await submitReport(session.id, fx.studentProfileIds.student6);
    expect(afterApproval.status).toBe(409);
    expect(afterApproval.body.error.code).toBe("REPORT_IMMUTABLE");
  });

  it("preserves rejection metadata on resubmission and freezes the money-affecting fields", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student7] });
    const first = await submitReport(session.id, fx.studentProfileIds.student7, fx.teacherUserId, reportPayload({
      attendanceOutcome: "ATTENDED",
      extraTimeMinutes: 15,
      summary: "Original summary.",
    }));
    expect(first.status).toBe(201);
    const reportId = first.body.data.id;

    const rejected = await reviewReport(reportId, "REJECT", fx.adminUserId, "Please add the recitation portion.");
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("REJECTED");

    // Approving a rejected report without resubmission is a conflict, not a silent approval.
    const premature = await reviewReport(reportId, "APPROVE", fx.adminUserId);
    expect(premature.status).toBe(409);

    const resubmitted = await submitReport(session.id, fx.studentProfileIds.student7, fx.teacherUserId, reportPayload({
      attendanceOutcome: "STUDENT_ABSENT",
      extraTimeMinutes: 0,
      summary: "Corrected summary.",
    }));
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.data.status).toBe("SUBMITTED");

    const row = await prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    expect(row.summary).toBe("Corrected summary.");
    // Money-affecting fields stay frozen from the first submission (owner decision 2026-10-14).
    expect(row.attendanceOutcome).toBe("ATTENDED");
    expect(row.extraTimeMinutes).toBe(15);
    expect(row.extraTimeStatus).toBe("PENDING");
    // Rejection audit trail survives the resubmission (F-02).
    expect(row.rejectionReason).toBe("Please add the recitation portion.");
    expect(row.rejectedAt).not.toBeNull();
    expect(row.rejectedById).toBe(fx.adminUserId);
  });

  it("writes attendance from the approved outcome exactly once, and an absent approval writes STUDENT_ABSENT with no ledger rows", async () => {
    await grantCredit(fx.studentProfileIds.student9, 4);
    const attended = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student9] });
    const attendedReport = await submitReport(attended.id, fx.studentProfileIds.student9);
    const approved = await reviewReport(attendedReport.body.data.id, "APPROVE", fx.adminUserId);
    expect(approved.status).toBe(200);
    const attendedRow = await prisma.sessionStudent.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: attended.id, studentId: fx.studentProfileIds.student9 } },
    });
    expect(attendedRow.attendanceStatus).toBe("ATTENDED");

    const absent = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student10] });
    const absentReport = await submitReport(absent.id, fx.studentProfileIds.student10, fx.teacherUserId, reportPayload({ attendanceOutcome: "STUDENT_ABSENT" }));
    const absentApproved = await reviewReport(absentReport.body.data.id, "APPROVE", fx.adminUserId);
    expect(absentApproved.status).toBe(200);
    const absentRow = await prisma.sessionStudent.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: absent.id, studentId: fx.studentProfileIds.student10 } },
    });
    expect(absentRow.attendanceStatus).toBe("STUDENT_ABSENT");

    const deductions = await prisma.subscriptionLedger.count({ where: { academyId: fx.academyId, entryType: "SESSION_DEDUCTION" } });
    expect(deductions).toBe(0);
  });

  it("treats a repeated approval as a clean no-op with alreadyHandled", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student8] });
    const submitted = await submitReport(session.id, fx.studentProfileIds.student8);
    const reportId = submitted.body.data.id;
    const first = await reviewReport(reportId, "APPROVE", fx.adminUserId);
    expect(first.status).toBe(200);
    expect(first.body.alreadyHandled).toBeUndefined();
    const second = await reviewReport(reportId, "APPROVE", fx.adminUserId);
    expect(second.status).toBe(200);
    expect(second.body.alreadyHandled).toBe(true);
  });

  it("lets exactly one of two concurrent approvals win; the loser reports already handled", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student11] });
    const submitted = await submitReport(session.id, fx.studentProfileIds.student11);
    const reportId = submitted.body.data.id;
    const [r1, r2] = await Promise.all([
      reviewReport(reportId, "APPROVE", fx.adminUserId),
      reviewReport(reportId, "APPROVE", fx.supervisorUserId),
    ]);
    const wins = [r1, r2].filter((result) => result.body?.data && result.body?.alreadyHandled !== true);
    const handled = [r1, r2].filter((result) => result.body?.alreadyHandled === true);
    expect(wins).toHaveLength(1);
    expect(handled).toHaveLength(1);
    const row = await prisma.sessionStudent.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: fx.studentProfileIds.student11 } },
    });
    expect(row.attendanceStatus).toBe("ATTENDED");
  });

  it("resolves a concurrent approve vs reject race with exactly one winner", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student12] });
    const submitted = await submitReport(session.id, fx.studentProfileIds.student12);
    const reportId = submitted.body.data.id;
    const [approve, reject] = await Promise.all([
      reviewReport(reportId, "APPROVE", fx.adminUserId),
      reviewReport(reportId, "REJECT", fx.supervisorUserId, "Raced decision."),
    ]);
    const statuses = [approve.status, reject.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    const row = await prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    const decided = [row.approvedAt !== null, row.rejectedAt !== null].filter(Boolean);
    expect(decided).toHaveLength(1);
  });

  it("forbids teacher and student review attempts", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student5] });
    const submitted = await submitReport(session.id, fx.studentProfileIds.student5);
    const teacherAttempt = await reviewReport(submitted.body.data.id, "APPROVE", fx.teacherUserId);
    expect(teacherAttempt.status).toBe(403);
    const studentAttempt = await reviewReport(submitted.body.data.id, "APPROVE", fx.studentUserIds.student5);
    expect(studentAttempt.status).toBe(403);
  });

  it("requires a rejection reason", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student6] });
    const submitted = await submitReport(session.id, fx.studentProfileIds.student6);
    const { status, body } = await reviewReport(submitted.body.data.id, "REJECT", fx.adminUserId);
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns a clean 400 for malformed identifiers instead of a 500", async () => {
    asActor(fx.teacherUserId);
    const badSubmit = await submitReportRoute(
      apiRequest(`/api/sessions/not-a-uuid/students/also-bad/report`, "POST", reportPayload()),
      { params: Promise.resolve({ id: "not-a-uuid", studentId: "also-bad" }) },
    );
    expect(badSubmit.status).toBe(400);
    const badReview = await reviewReport("nope", "APPROVE", fx.adminUserId);
    expect(badReview.status).toBe(400);
  });

  it("gives the supervisor the full review response with no money fields anywhere", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student7] });
    const submitted = await submitReport(session.id, fx.studentProfileIds.student7, fx.teacherUserId, reportPayload({ extraTimeMinutes: 10 }));
    const { status, body } = await reviewReport(submitted.body.data.id, "APPROVE", fx.supervisorUserId);
    expect(status).toBe(200);
    expect(body.data.status).toBe("APPROVED");
    const serialized = JSON.stringify(body).toLowerCase();
    for (const token of ["hourly", "amount_minor", "amountminor", "payroll", "salary", "wage", "rate_snapshot"]) {
      expect(serialized).not.toContain(token);
    }
  });

  it("cancels pending late-report nudges once every roster student has submitted", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student8], minutesAgoEnded: 5 });
    await processLateReportNotifications(new Date(), fx.academyId);
    expect(
      await prisma.notificationJob.count({ where: { sessionId: session.id, kind: "REPORT_REMINDER", status: "PENDING" } }),
    ).toBe(1);
    const { status } = await submitReport(session.id, fx.studentProfileIds.student8);
    expect(status).toBe(201);
    const job = await prisma.notificationJob.findFirstOrThrow({ where: { sessionId: session.id, kind: "REPORT_REMINDER" } });
    expect(job.status).toBe("CANCELLED");
  });

  it("keeps the settlement seam a no-op inside the approval transaction (no money rows in Phase 5)", async () => {
    await prisma.$transaction(async (tx) => {
      await settleApprovedReport(tx, {
        id: randomUUID(),
        sessionId: randomUUID(),
        studentId: randomUUID(),
        attendanceOutcome: "ATTENDED",
      });
    });
    const deductions = await prisma.subscriptionLedger.count({ where: { academyId: fx.academyId, entryType: "SESSION_DEDUCTION" } });
    expect(deductions).toBe(0);
  });
});
