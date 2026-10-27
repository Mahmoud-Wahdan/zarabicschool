jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { GET as previewRoute, POST as resolveRoute } from "../../app/api/sessions/[id]/students/[studentId]/attendance-resolution/route";
import { POST as submitReportRoute } from "../../app/api/sessions/[id]/students/[studentId]/report/route";
import { POST as reviewReportRoute } from "../../app/api/reports/[id]/review/route";
import { resolveAttendance } from "../../lib/attendance/resolution";
import { deriveRosterState } from "../../lib/attendance/roster-state";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
  writeInitialPurchase,
} from "../helpers/session-fixtures";

/**
 * S-01 manual attendance resolution (D2, D36, D37; owner 2026-10-27: BLOCK when the
 * student has no sessions left). A resolution writes the student's attendance and
 * ledger effect only: ATTENDED = reservation CONSUMED + one SESSION_DEDUCTION;
 * STUDENT_ABSENT = reservation RELEASED, no ledger row. Never a payroll row, never a
 * report, never a session status change. A later teacher report is still accepted:
 * its approval writes only the teacher credit; a different outcome raises an Admin
 * flag and the resolution stands. Per-run test academy only.
 */
jest.setTimeout(240_000);

const DAY = 24 * 3600 * 1000;
const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function url(sessionId: string, studentId: string, query = "") {
  return `http://localhost:3000/api/sessions/${sessionId}/students/${studentId}/attendance-resolution${query}`;
}

async function resolve(sessionId: string, studentId: string, actorId: string, body: Record<string, unknown>) {
  asActor(actorId);
  const response = await resolveRoute(
    new Request(url(sessionId, studentId), { method: "POST", headers: sameOriginHeaders({ "content-type": "application/json" }), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: sessionId, studentId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function preview(sessionId: string, studentId: string, actorId: string, outcome: string) {
  asActor(actorId);
  const response = await previewRoute(new Request(url(sessionId, studentId, `?outcome=${outcome}`)), {
    params: Promise.resolve({ id: sessionId, studentId }),
  });
  return { status: response.status, body: await response.json() };
}

const VALID = { outcome: "ATTENDED", reason: "Teacher confirmed by phone; report delayed.", confirm: true };

async function submitReport(sessionId: string, studentId: string, outcome: "ATTENDED" | "STUDENT_ABSENT") {
  asActor(fx.teacherUserId);
  const response = await submitReportRoute(
    new Request(`http://localhost:3000/api/sessions/${sessionId}/students/${studentId}/report`, {
      method: "POST",
      headers: sameOriginHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ attendanceOutcome: outcome, classRemark: "good", summary: "Covered the lesson content.", homework: "Practice page 12.", notes: "", extraTimeMinutes: 0 }),
    }),
    { params: Promise.resolve({ id: sessionId, studentId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function approve(reportId: string) {
  asActor(fx.adminUserId);
  const response = await reviewReportRoute(
    new Request(`http://localhost:3000/api/reports/${reportId}/review`, { method: "POST", headers: sameOriginHeaders({ "content-type": "application/json" }), body: JSON.stringify({ action: "APPROVE" }) }),
    { params: Promise.resolve({ id: reportId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function credit(studentId: string, sessions: number) {
  const subscription = await prisma.subscription.create({
    data: {
      academyId: fx.academyId, studentId, packageType: "MONTHLY_PLAN", sessionsPurchased: sessions,
      totalAmountMinor: BigInt(100000), currency: "EGP", status: "ACTIVE",
      periodStartsAt: new Date(Date.now() - 30 * DAY), periodEndsAt: new Date(Date.now() + 30 * DAY),
    },
    select: { id: true },
  });
  await writeInitialPurchase({ academyId: fx.academyId, subscriptionId: subscription.id, sessionsDelta: sessions });
  return subscription.id;
}

/** A session that ended `endedAgoMs` ago, with the student on the roster (and a reservation when given). */
async function endedSession(studentId: string, options: { endedAgoMs?: number; subscriptionId?: string; status?: "SCHEDULED" | "CANCELLED" | "COMPLETED"; endsInFuture?: boolean } = {}) {
  const end = new Date(options.endsInFuture ? Date.now() + 3600 * 1000 : Date.now() - (options.endedAgoMs ?? 3600 * 1000));
  const session = await prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
      scheduledStart: new Date(end.getTime() - 3600 * 1000), scheduledEnd: end, durationMinutes: 60,
      timezone: "Africa/Cairo", zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId,
      status: options.status ?? "SCHEDULED",
      students: { create: [{ studentId }] },
    },
    select: { id: true },
  });
  if (options.subscriptionId) {
    await prisma.sessionReservation.create({ data: { academyId: fx.academyId, sessionId: session.id, studentId, subscriptionId: options.subscriptionId } });
  }
  return session.id;
}

async function ledgerRows(sessionId: string) {
  return prisma.subscriptionLedger.findMany({ where: { sessionId }, select: { id: true, entryType: true, sessionsDelta: true, reportId: true } });
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-01 manual attendance resolution", () => {
  it("ATT-01: Admin ATTENDED consumes the reservation, writes one deduction and the audit row, no payroll, no status change, Admin notice", async () => {
    const student = fx.studentProfileIds.student1;
    const subscriptionId = await credit(student, 4);
    const sessionId = await endedSession(student, { subscriptionId });
    const result = await resolve(sessionId, student, fx.adminUserId, VALID);
    expect(result.status).toBe(201);
    const ledger = await ledgerRows(sessionId);
    expect(ledger).toEqual([expect.objectContaining({ entryType: "SESSION_DEDUCTION", sessionsDelta: -1, reportId: null })]);
    const reservation = await prisma.sessionReservation.findFirstOrThrow({ where: { sessionId, studentId: student } });
    expect(reservation.status).toBe("CONSUMED");
    const row = await prisma.attendanceResolution.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId, studentId: student } } });
    expect(row).toMatchObject({ outcome: "ATTENDED", resolvedById: fx.adminUserId, resolvedByRole: "ADMIN", subscriptionLedgerId: ledger[0].id });
    const attendance = await prisma.sessionStudent.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId, studentId: student } } });
    expect(attendance.attendanceStatus).toBe("ATTENDED");
    expect(await prisma.payrollLedger.count({ where: { sessionId } })).toBe(0);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("SCHEDULED");
    expect(await prisma.notificationJob.count({ where: { academyId: fx.academyId, kind: "ATTENDANCE_RESOLVED", recipientUserId: fx.adminUserId } })).toBeGreaterThan(0);
  });

  it("ATT-02: STUDENT_ABSENT releases the reservation and writes no ledger row", async () => {
    const student = fx.studentProfileIds.student2;
    const subscriptionId = await credit(student, 2);
    const sessionId = await endedSession(student, { subscriptionId });
    const result = await resolve(sessionId, student, fx.adminUserId, { ...VALID, outcome: "STUDENT_ABSENT" });
    expect(result.status).toBe(201);
    expect(await ledgerRows(sessionId)).toEqual([]);
    expect((await prisma.sessionReservation.findFirstOrThrow({ where: { sessionId, studentId: student } })).status).toBe("RELEASED");
    const row = await prisma.attendanceResolution.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId, studentId: student } } });
    expect(row.subscriptionLedgerId).toBeNull();
  });

  it("ATT-03: ATTENDED is BLOCKED when the student has no sessions left (owner, 2026-10-27) — nothing is written", async () => {
    const student = fx.studentProfileIds.student3;
    const sessionId = await endedSession(student);
    const blocked = await preview(sessionId, student, fx.adminUserId, "ATTENDED");
    expect(blocked.status).toBe(200);
    expect(blocked.body.data).toMatchObject({ canResolve: false, blockCode: "NO_SESSIONS_LEFT" });
    const result = await resolve(sessionId, student, fx.adminUserId, VALID);
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("NO_SESSIONS_LEFT");
    expect(await ledgerRows(sessionId)).toEqual([]);
    expect(await prisma.attendanceResolution.count({ where: { sessionId } })).toBe(0);
    // An absence moves no credit, so it is never blocked.
    expect((await resolve(sessionId, student, fx.adminUserId, { ...VALID, outcome: "STUDENT_ABSENT" })).status).toBe(201);
  });

  it("ATT-04: refusals — not ended, off roster, cancelled, report already submitted, already resolved, bad reason, no confirmation", async () => {
    const student = fx.studentProfileIds.student4;
    const subscriptionId = await credit(student, 6);
    const future = await endedSession(student, { endsInFuture: true, subscriptionId });
    expect((await resolve(future, student, fx.adminUserId, VALID)).body.error.code).toBe("SESSION_NOT_ENDED");
    const ended = await endedSession(student, { subscriptionId });
    expect((await resolve(ended, fx.studentProfileIds.student5, fx.adminUserId, VALID)).status).toBe(404);
    const cancelled = await endedSession(student, { status: "CANCELLED" });
    expect((await resolve(cancelled, student, fx.adminUserId, VALID)).body.error.code).toBe("SESSION_NOT_RESOLVABLE");
    const reported = await endedSession(student);
    expect((await submitReport(reported, student, "ATTENDED")).status).toBe(201);
    expect((await resolve(reported, student, fx.adminUserId, VALID)).body.error.code).toBe("REPORT_EXISTS");
    expect((await resolve(ended, student, fx.adminUserId, { ...VALID, reason: "no" })).status).toBe(400);
    expect((await resolve(ended, student, fx.adminUserId, { ...VALID, confirm: false })).body.error.code).toBe("CONFIRMATION_REQUIRED");
    expect((await resolve(ended, student, fx.adminUserId, VALID)).status).toBe(201);
    expect((await resolve(ended, student, fx.adminUserId, VALID)).body.error.code).toBe("ALREADY_RESOLVED");
    expect(await prisma.subscriptionLedger.count({ where: { sessionId: ended, entryType: "SESSION_DEDUCTION" } })).toBe(1);
  });

  it("ATT-05: roles — Supervisor within 7 days of the scheduled end, Admin only after; teacher, student and foreign Admin refused", async () => {
    const student = fx.studentProfileIds.student6;
    const subscriptionId = await credit(student, 6);
    const recent = await endedSession(student, { endedAgoMs: 6 * DAY, subscriptionId });
    expect((await resolve(recent, student, fx.supervisorUserId, { ...VALID, outcome: "STUDENT_ABSENT" })).status).toBe(201);
    const old = await endedSession(student, { endedAgoMs: 8 * DAY });
    const supervisorOld = await resolve(old, student, fx.supervisorUserId, { ...VALID, outcome: "STUDENT_ABSENT" });
    expect(supervisorOld.status).toBe(403);
    expect(supervisorOld.body.error.code).toBe("ADMIN_ONLY_AFTER_7_DAYS");
    expect((await resolve(old, student, fx.teacherUserId, VALID)).status).toBe(403);
    expect((await resolve(old, student, fx.studentUserIds.student6, VALID)).status).toBe(403);
    expect((await resolve(old, student, fx.foreignAdminUserId, VALID)).status).toBe(404);
    expect((await resolve(old, student, fx.adminUserId, { ...VALID, outcome: "STUDENT_ABSENT" })).status).toBe(201);
    const row = await prisma.attendanceResolution.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: recent, studentId: student } } });
    expect(row.resolvedByRole).toBe("SUPERVISOR");
  });

  it("ATT-06: the preview states the exact effect (deduction, sessions left, teacher NOT credited) and never shows money", async () => {
    const student = fx.studentProfileIds.student7;
    const subscriptionId = await credit(student, 3);
    const sessionId = await endedSession(student, { subscriptionId });
    const attended = await preview(sessionId, student, fx.supervisorUserId, "ATTENDED");
    expect(attended.body.data).toMatchObject({
      canResolve: true,
      effect: { attendance: "ATTENDED", deductsSession: true, releasesReservation: false, teacherCredited: false, sessionsLeftBefore: 2, sessionsLeftAfter: 2 },
    });
    const absent = await preview(sessionId, student, fx.supervisorUserId, "STUDENT_ABSENT");
    expect(absent.body.data.effect).toMatchObject({ deductsSession: false, releasesReservation: true, sessionsLeftAfter: 3 });
    expect(JSON.stringify(attended.body)).not.toMatch(/amount|minor|currency|rate/i);
  });

  it("ATT-07: a later teacher report is accepted; its approval writes only the teacher credit, never a second deduction", async () => {
    const student = fx.studentProfileIds.student8;
    const subscriptionId = await credit(student, 4);
    const sessionId = await endedSession(student, { subscriptionId });
    expect((await resolve(sessionId, student, fx.adminUserId, VALID)).status).toBe(201);
    const report = await submitReport(sessionId, student, "ATTENDED");
    expect(report.status).toBe(201);
    const approved = await approve(report.body.data.id);
    expect(approved.status).toBe(200);
    expect(await prisma.subscriptionLedger.count({ where: { sessionId, entryType: "SESSION_DEDUCTION" } })).toBe(1);
    expect(await prisma.payrollLedger.count({ where: { sessionId, entryType: "SESSION_CREDIT" } })).toBe(1);
    expect(await prisma.notificationJob.count({ where: { academyId: fx.academyId, kind: "ATTENDANCE_RESOLUTION_MISMATCH" } })).toBe(0);
  });

  it("ATT-08: a disagreeing report changes nothing automatically — the resolution stands and the Admin is flagged", async () => {
    const student = fx.studentProfileIds.student9;
    const subscriptionId = await credit(student, 4);
    const sessionId = await endedSession(student, { subscriptionId });
    expect((await resolve(sessionId, student, fx.adminUserId, { ...VALID, outcome: "STUDENT_ABSENT" })).status).toBe(201);
    const report = await submitReport(sessionId, student, "ATTENDED");
    const approved = await approve(report.body.data.id);
    expect(approved.status).toBe(200);
    const attendance = await prisma.sessionStudent.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId, studentId: student } } });
    expect(attendance.attendanceStatus).toBe("STUDENT_ABSENT");
    expect(await prisma.subscriptionLedger.count({ where: { sessionId, entryType: "SESSION_DEDUCTION" } })).toBe(0);
    // The teacher's pay comes from the approved report (D36b): ATTENDED report → one credit.
    expect(await prisma.payrollLedger.count({ where: { sessionId, entryType: "SESSION_CREDIT" } })).toBe(1);
    expect(await prisma.notificationJob.count({ where: { academyId: fx.academyId, kind: "ATTENDANCE_RESOLUTION_MISMATCH", recipientUserId: fx.adminUserId } })).toBe(1);
  });

  it("ATT-09: 'finished, report pending' is derived from time and reports; a resolution shows 'resolved manually, report pending'", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const ended = new Date("2026-10-30T11:00:00Z");
    expect(deriveRosterState({ sessionStatus: "SCHEDULED", scheduledEnd: new Date("2026-10-30T13:00:00Z"), now, reportStatus: null, resolutionOutcome: null })).toBe("NOT_ENDED");
    expect(deriveRosterState({ sessionStatus: "SCHEDULED", scheduledEnd: ended, now, reportStatus: null, resolutionOutcome: null })).toBe("ENDED_REPORT_PENDING");
    expect(deriveRosterState({ sessionStatus: "SCHEDULED", scheduledEnd: ended, now, reportStatus: null, resolutionOutcome: "ATTENDED" })).toBe("RESOLVED_REPORT_PENDING");
    expect(deriveRosterState({ sessionStatus: "SCHEDULED", scheduledEnd: ended, now, reportStatus: "SUBMITTED", resolutionOutcome: "ATTENDED" })).toBe("REPORT_SUBMITTED");
    expect(deriveRosterState({ sessionStatus: "COMPLETED", scheduledEnd: ended, now, reportStatus: "APPROVED", resolutionOutcome: null })).toBe("REPORT_APPROVED");
    expect(deriveRosterState({ sessionStatus: "CANCELLED", scheduledEnd: ended, now, reportStatus: null, resolutionOutcome: null })).toBe("CANCELLED");
  });

  it("ATT-11: every deduction without a report belongs to exactly one resolution; S-1b migration is BOM-free and keeps the -1 + session rule", async () => {
    const orphans = await prisma.subscriptionLedger.findMany({
      where: { academyId: fx.academyId, entryType: "SESSION_DEDUCTION", reportId: null },
      select: { id: true, attendanceResolutions: { select: { id: true } } },
    });
    expect(orphans.length).toBeGreaterThan(0);
    for (const row of orphans) expect(row.attendanceResolutions).toHaveLength(1);
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("prisma/migrations/20261027130000_subscription_ledger_manual_deduction/migration.sql");
    expect(sql.subarray(0, 3).toString("hex")).not.toBe("efbbbf");
    expect(sql.toString("utf8")).toMatch(/"entry_type" <> 'SESSION_DEDUCTION' OR \("sessions_delta" = -1 AND "session_id" IS NOT NULL\)/);
  });

  it("ATT-10: a resolution racing a report submission on the same session never double-deducts", async () => {
    const student = fx.studentProfileIds.student10;
    const subscriptionId = await credit(student, 4);
    const sessionId = await endedSession(student, { subscriptionId });
    asActor(fx.teacherUserId);
    const [resolved, submitted] = await Promise.allSettled([
      resolveAttendance({ id: fx.adminUserId, role: "ADMIN", academyId: fx.academyId }, { sessionId, studentId: student, outcome: "ATTENDED", reason: VALID.reason }),
      submitReport(sessionId, student, "ATTENDED"),
    ]);
    expect(submitted.status).toBe("fulfilled");
    const report = submitted.status === "fulfilled" ? submitted.value : null;
    expect(report?.status).toBe(201);
    // Either order is valid: resolution first (report still accepted) or report first (resolution refused REPORT_EXISTS).
    if (resolved.status === "rejected") expect((resolved.reason as { code?: string }).code).toBe("REPORT_EXISTS");
    expect((await approve(report!.body.data.id)).status).toBe(200);
    expect(await prisma.subscriptionLedger.count({ where: { sessionId, entryType: "SESSION_DEDUCTION" } })).toBe(1);
  });
});
