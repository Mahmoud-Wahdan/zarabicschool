jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { randomUUID } from "node:crypto";

import { getServerSession } from "next-auth";

import { prisma } from "../../lib/prisma";
import { processDueNotificationJobs, processLateReportNotifications } from "../../lib/worker/notifications";
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
  teacherProfileId?: string;
}) {
  const end = new Date(Date.now() - (options.minutesAgoEnded ?? 10) * 60 * 1000);
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  return prisma.session.create({
    data: {
      academyId: fx.academyId,
      teacherId: options.teacherProfileId ?? fx.teacherProfileId,
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
  return subscription;
}

/** The seam finalizes a real Reports row — direct-seam tests create one first. */
async function createApprovedReportRow(sessionId: string, studentId: string, teacherProfileId = fx.teacherProfileId) {
  const report = await prisma.report.create({
    data: {
      academyId: fx.academyId,
      sessionId,
      studentId,
      teacherId: teacherProfileId,
      reportType: "SESSION_COMPLETION_REPORT",
      status: "APPROVED",
      attendanceOutcome: "ATTENDED",
      classRemark: "good",
      summary: "Settlement test report.",
      homework: "Do the exercises.",
      approvedById: fx.adminUserId,
      approvedAt: new Date(),
    },
    select: { id: true },
  });
  return report.id;
}

async function withProviderUnconfigured(run: () => Promise<void>) {
  const previous = {
    provider: process.env.MESSAGING_PROVIDER,
    url: process.env.OPENWA_URL,
    apiKey: process.env.OPENWA_API_KEY,
    sessionId: process.env.OPENWA_SESSION_ID,
  };
  process.env.MESSAGING_PROVIDER = "openwa";
  delete process.env.OPENWA_URL;
  delete process.env.OPENWA_API_KEY;
  delete process.env.OPENWA_SESSION_ID;
  try {
    await run();
  } finally {
    if (previous.provider === undefined) delete process.env.MESSAGING_PROVIDER; else process.env.MESSAGING_PROVIDER = previous.provider;
    if (previous.url === undefined) delete process.env.OPENWA_URL; else process.env.OPENWA_URL = previous.url;
    if (previous.apiKey === undefined) delete process.env.OPENWA_API_KEY; else process.env.OPENWA_API_KEY = previous.apiKey;
    if (previous.sessionId === undefined) delete process.env.OPENWA_SESSION_ID; else process.env.OPENWA_SESSION_ID = previous.sessionId;
  }
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

    // Phase 6: the attended approval settles (one deduction for its session); the
    // absent approval writes ZERO ledger rows for its own session.
    const attendedDeductions = await prisma.subscriptionLedger.count({
      where: { academyId: fx.academyId, sessionId: attended.id, entryType: "SESSION_DEDUCTION" },
    });
    expect(attendedDeductions).toBe(1);
    const absentDeductions = await prisma.subscriptionLedger.count({
      where: { academyId: fx.academyId, sessionId: absent.id, entryType: "SESSION_DEDUCTION" },
    });
    expect(absentDeductions).toBe(0);
    const absentCredits = await prisma.payrollLedger.count({
      where: { academyId: fx.academyId, sessionId: absent.id, entryType: "SESSION_CREDIT" },
    });
    expect(absentCredits).toBe(0);
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

  it("settlement with no teacher rate fails cleanly and writes no money rows", async () => {
    // A dedicated teacher WITHOUT any rate row: deleting the fixture rate is not
    // possible (settled credits from earlier tests reference it, RESTRICT FK).
    const suffix = randomUUID().slice(0, 8);
    const noRateUser = await prisma.user.create({
      data: {
        academyId: fx.academyId,
        username: `demo_test_norate_${suffix}`,
        displayName: "Demo Test No-Rate Teacher",
        passwordHash: "x".repeat(60),
        role: "TEACHER",
        phone: "+201000000099",
        timezone: "Africa/Cairo",
        isActive: true,
        mustChangePassword: false,
      },
      select: { id: true },
    });
    const noRateTeacher = await prisma.teacher.create({
      data: { userId: noRateUser.id, academyId: fx.academyId },
      select: { id: true },
    });
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student3], teacherProfileId: noRateTeacher.id });
    const subscription = await grantCredit(fx.studentProfileIds.student3, 4);
    await prisma.sessionReservation.create({
      data: { academyId: fx.academyId, sessionId: session.id, studentId: fx.studentProfileIds.student3, subscriptionId: subscription.id },
    });
    const reportId = await createApprovedReportRow(session.id, fx.studentProfileIds.student3, noRateTeacher.id);
    await expect(
      prisma.$transaction(async (tx) =>
        settleApprovedReport(tx, {
          id: reportId,
          academyId: fx.academyId,
          sessionId: session.id,
          studentId: fx.studentProfileIds.student3,
          teacherId: noRateTeacher.id,
          attendanceOutcome: "ATTENDED",
        }),
      ),
    ).rejects.toMatchObject({ code: "NO_TEACHER_RATE" });
    const deductions = await prisma.subscriptionLedger.count({ where: { academyId: fx.academyId, sessionId: session.id, entryType: "SESSION_DEDUCTION" } });
    expect(deductions).toBe(0);
    const credits = await prisma.payrollLedger.count({ where: { academyId: fx.academyId, sessionId: session.id, entryType: "SESSION_CREDIT" } });
    expect(credits).toBe(0);
  });

  it("settles an attended report atomically: deduction + one credit + markers + consumed reservation", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student4] });
    const subscription = await grantCredit(fx.studentProfileIds.student4, 4);
    await prisma.sessionReservation.create({
      data: { academyId: fx.academyId, sessionId: session.id, studentId: fx.studentProfileIds.student4, subscriptionId: subscription.id },
    });
    const rate = await prisma.teacherRate.create({
      data: {
        academyId: fx.academyId,
        teacherId: fx.teacherProfileId,
        hourlyRateMinor: 6000, // 60 EGP/hour → 60-minute session credits 6000 minor
        currency: "EGP",
        effectiveFrom: new Date(Date.now() - 90 * 24 * 3600 * 1000),
        createdById: fx.adminUserId,
      },
      select: { id: true },
    });
    const reportId = await createApprovedReportRow(session.id, fx.studentProfileIds.student4);
    await prisma.$transaction(async (tx) =>
      settleApprovedReport(tx, {
        id: reportId,
        academyId: fx.academyId,
        sessionId: session.id,
        studentId: fx.studentProfileIds.student4,
        teacherId: fx.teacherProfileId,
        attendanceOutcome: "ATTENDED",
      }),
    );
    const deduction = await prisma.subscriptionLedger.findFirstOrThrow({ where: { sessionId: session.id, entryType: "SESSION_DEDUCTION" } });
    expect(deduction.sessionsDelta).toBe(-1);
    expect(deduction.subscriptionId).toBe(subscription.id);
    const credit = await prisma.payrollLedger.findFirstOrThrow({ where: { sessionId: session.id, entryType: "SESSION_CREDIT" } });
    expect(credit.amountMinor).toBe(6000);
    expect(credit.minutesCredited).toBe(60);
    expect(credit.hourlyRateSnapshotMinor).toBe(6000);
    expect(credit.teacherRateId).toBe(rate.id);
    expect(credit.createdById).toBeNull();
    const reservation = await prisma.sessionReservation.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: fx.studentProfileIds.student4 } },
    });
    expect(reservation.status).toBe("CONSUMED");
  });

  it("absent reports settle with zero money and release the reservation", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student5] });
    const subscription = await grantCredit(fx.studentProfileIds.student5, 4);
    await prisma.sessionReservation.create({
      data: { academyId: fx.academyId, sessionId: session.id, studentId: fx.studentProfileIds.student5, subscriptionId: subscription.id },
    });
    await prisma.teacherRate.create({
      data: {
        academyId: fx.academyId,
        teacherId: fx.teacherProfileId,
        hourlyRateMinor: 6000,
        currency: "EGP",
        effectiveFrom: new Date(Date.now() - 90 * 24 * 3600 * 1000),
        createdById: fx.adminUserId,
      },
    });
    const reportId = await createApprovedReportRow(session.id, fx.studentProfileIds.student5);
    await prisma.$transaction(async (tx) =>
      settleApprovedReport(tx, {
        id: reportId,
        academyId: fx.academyId,
        sessionId: session.id,
        studentId: fx.studentProfileIds.student5,
        teacherId: fx.teacherProfileId,
        attendanceOutcome: "STUDENT_ABSENT",
      }),
    );
    const deductions = await prisma.subscriptionLedger.count({ where: { sessionId: session.id, entryType: "SESSION_DEDUCTION" } });
    expect(deductions).toBe(0);
    const credits = await prisma.payrollLedger.count({ where: { sessionId: session.id, entryType: "SESSION_CREDIT" } });
    expect(credits).toBe(0);
    const reservation = await prisma.sessionReservation.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: fx.studentProfileIds.student5 } },
    });
    expect(reservation.status).toBe("RELEASED");
    expect(reservation.releasedAt).not.toBeNull();
  });

  it("queues the guardian approval notice and the teacher rejection notice after commit (Batch D)", async () => {
    const approvedSession = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student1] });
    const submitted = await submitReport(approvedSession.id, fx.studentProfileIds.student1);
    const approved = await reviewReport(submitted.body.data.id, "APPROVE", fx.adminUserId);
    expect(approved.status).toBe(200);
    // The student has a linked guardian → the guardian is the approval recipient (decision 7).
    const approveJob = await prisma.notificationJob.findFirstOrThrow({
      where: { kind: "REPORT_APPROVED", dedupKey: `REPORT_APPROVED:${submitted.body.data.id}` },
    });
    expect(approveJob.recipientUserId).toBe(fx.guardianUserId);
    await processDueNotificationJobs(new Date(), fx.academyId);
    const sent = await prisma.notificationJob.findUniqueOrThrow({ where: { id: approveJob.id } });
    expect(sent.status).toBe("SENT");

    const rejectedSession = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student2] });
    const submitted2 = await submitReport(rejectedSession.id, fx.studentProfileIds.student2);
    const rejected = await reviewReport(submitted2.body.data.id, "REJECT", fx.adminUserId, "Fix the summary.");
    expect(rejected.status).toBe(200);
    const rejectJob = await prisma.notificationJob.findFirstOrThrow({
      where: { kind: "REPORT_REJECTED", dedupKey: { startsWith: `REPORT_REJECTED:${submitted2.body.data.id}:` } },
    });
    expect(rejectJob.recipientUserId).toBe(fx.teacherUserId);
  });

  it("an adult student without a guardian receives the approval notice (decision 7)", async () => {
    const adultUser = await prisma.user.create({
      data: {
        academyId: fx.academyId,
        username: `demo_test_adult2_${fx.suffix}`,
        displayName: "Demo Test Adult Two",
        passwordHash: "x".repeat(60),
        role: "STUDENT",
        timezone: "Africa/Cairo",
        isActive: true,
        mustChangePassword: false,
      },
      select: { id: true },
    });
    const adultStudent = await prisma.student.create({
      data: { userId: adultUser.id, academyId: fx.academyId, isAdult: true, enrollmentDate: new Date() },
      select: { id: true },
    });
    const session = await createPastSession({ studentProfileIds: [adultStudent.id] });
    const submitted = await submitReport(session.id, adultStudent.id);
    const approved = await reviewReport(submitted.body.data.id, "APPROVE", fx.adminUserId);
    expect(approved.status).toBe(200);
    const job = await prisma.notificationJob.findFirstOrThrow({
      where: { kind: "REPORT_APPROVED", dedupKey: `REPORT_APPROVED:${submitted.body.data.id}` },
    });
    expect(job.recipientUserId).toBe(adultUser.id);
  });

  it("a failed approval notice never rolls the approval back and stores no secrets (Batch D)", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student3] });
    const submitted = await submitReport(session.id, fx.studentProfileIds.student3);
    const approved = await reviewReport(submitted.body.data.id, "APPROVE", fx.adminUserId);
    expect(approved.status).toBe(200);
    const row = await prisma.report.findUniqueOrThrow({ where: { id: submitted.body.data.id } });
    expect(row.status).toBe("APPROVED");

    await withProviderUnconfigured(async () => {
      await processDueNotificationJobs(new Date(), fx.academyId);
    });
    const failed = await prisma.notificationJob.findFirstOrThrow({
      where: { kind: "REPORT_APPROVED", dedupKey: `REPORT_APPROVED:${submitted.body.data.id}` },
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.lastError).toBe("OpenWA is not configured.");
    expect(failed.lastError).not.toContain("zoom.us");
    // The decision stands regardless of the messaging failure.
    const stillApproved = await prisma.report.findUniqueOrThrow({ where: { id: submitted.body.data.id } });
    expect(stillApproved.status).toBe("APPROVED");
  });
});
