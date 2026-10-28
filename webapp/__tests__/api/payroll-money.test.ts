jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { randomUUID } from "node:crypto";

import { getServerSession } from "next-auth";

import { POST as adjustmentRoute } from "../../app/api/payroll/adjustments/route";
import { POST as disbursementRoute } from "../../app/api/payroll/disbursements/route";
import { POST as overtimeRoute } from "../../app/api/reports/[id]/overtime/route";
import { creditAmountMinor } from "../../lib/payroll/rates";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Teacher money (Phase 8, risk-ranked first): Admin adjustments and disbursements
 * (A5: idempotency, one currency per teacher, append-only) and overtime decisions
 * (A3: claim + ledger in ONE transaction, once per report). Per-run test academy.
 */
jest.setTimeout(180_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function post(pathName: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${pathName}`, {
    method: "POST",
    headers: sameOriginHeaders({ "content-type": "application/json", ...headers }),
    body: JSON.stringify(body),
  });
}

async function adjust(actorId: string, body: Record<string, unknown>, key?: string) {
  asActor(actorId);
  const response = await adjustmentRoute(post("/api/payroll/adjustments", body, key ? { "idempotency-key": key } : {}));
  return { status: response.status, body: await response.json() };
}

async function disburse(actorId: string, body: Record<string, unknown>, key?: string) {
  asActor(actorId);
  const response = await disbursementRoute(post("/api/payroll/disbursements", body, key ? { "idempotency-key": key } : {}));
  return { status: response.status, body: await response.json() };
}

const adjustment = (overrides: Record<string, unknown> = {}) => ({
  teacherId: fx.teacherProfileId, amountMinor: 2500, currency: "EGP", category: "OTHER", reason: "Demo test bonus", ...overrides,
});

async function overtimeReport(options: { status?: "APPROVED" | "SUBMITTED"; minutes?: number; teacherProfileId?: string } = {}) {
  const end = new Date(Date.now() - 60 * 60 * 1000);
  const studentId = fx.studentProfileIds.student1;
  const session = await prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: options.teacherProfileId ?? fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
      scheduledStart: new Date(end.getTime() - 60 * 60 * 1000), scheduledEnd: end, durationMinutes: 60, timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status: "COMPLETED",
      students: { create: [{ studentId }] },
    },
    select: { id: true },
  });
  return prisma.report.create({
    data: {
      academyId: fx.academyId, sessionId: session.id, studentId, teacherId: options.teacherProfileId ?? fx.teacherProfileId,
      reportType: "SESSION_COMPLETION_REPORT", status: options.status ?? "APPROVED", attendanceOutcome: "ATTENDED",
      classRemark: "good", summary: "Overtime test.", homework: "None.",
      extraTimeMinutes: options.minutes ?? 15, extraTimeStatus: "PENDING",
      ...(options.status === "SUBMITTED" ? {} : { approvedById: fx.adminUserId, approvedAt: new Date() }),
    },
    select: { id: true },
  });
}

async function decideOvertime(actorId: string, reportId: string, action: "APPROVE" | "REJECT") {
  asActor(actorId);
  const response = await overtimeRoute(post(`/api/reports/${reportId}/overtime`, { action }), { params: Promise.resolve({ id: reportId }) });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Payroll adjustments and disbursements (A5)", () => {
  it("PAY-01: an Admin bonus and fine are written once each, signed, in the teacher's currency, with the Admin as author", async () => {
    const bonus = await adjust(fx.adminUserId, adjustment({ amountMinor: 2500 }));
    expect(bonus.status).toBe(201);
    const fine = await adjust(fx.adminUserId, adjustment({ amountMinor: -1000, reason: "Demo test fine" }));
    expect(fine.status).toBe(201);
    const rows = await prisma.payrollLedger.findMany({ where: { id: { in: [bonus.body.data.id, fine.body.data.id] } }, select: { amountMinor: true, currency: true, createdById: true, entryType: true } });
    expect(rows.map((row) => row.amountMinor).sort((a, b) => a - b)).toEqual([-1000, 2500]);
    expect(rows.every((row) => row.currency === "EGP" && row.createdById === fx.adminUserId && row.entryType === "ADMIN_ADJUSTMENT")).toBe(true);
  });

  it("PAY-02: the same Idempotency-Key replays the first row (200), never a second row", async () => {
    const key = randomUUID();
    const first = await adjust(fx.adminUserId, adjustment({ amountMinor: 777 }), key);
    expect(first.status).toBe(201);
    const replay = await adjust(fx.adminUserId, adjustment({ amountMinor: 777, reason: "different reason text" }), key);
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(await prisma.payrollLedger.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it("PAY-03: the same key for a DIFFERENT amount is refused 409 IDEMPOTENCY_KEY_REUSED", async () => {
    const key = randomUUID();
    await adjust(fx.adminUserId, adjustment({ amountMinor: 100 }), key);
    const reused = await adjust(fx.adminUserId, adjustment({ amountMinor: 200 }), key);
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("PAY-04: two concurrent requests with one key write ONE row", async () => {
    const key = randomUUID();
    const results = await Promise.all([adjust(fx.adminUserId, adjustment({ amountMinor: 333 }), key), adjust(fx.adminUserId, adjustment({ amountMinor: 333 }), key)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 201]);
    expect(await prisma.payrollLedger.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it("PAY-05: validation and money rules — bad key, zero, wrong currency, no rate, oversized amount", async () => {
    expect((await adjust(fx.adminUserId, adjustment(), "not-a-uuid")).status).toBe(400);
    expect((await adjust(fx.adminUserId, adjustment({ amountMinor: 0 }))).status).toBe(400);
    expect((await adjust(fx.adminUserId, adjustment({ amountMinor: 1.5 }))).status).toBe(400);
    const usd = await adjust(fx.adminUserId, adjustment({ currency: "USD" }));
    expect(usd.status).toBe(409);
    expect(usd.body.error.code).toBe("CURRENCY_MISMATCH");
    // A teacher without any rate has no currency yet.
    const user = await prisma.user.create({
      data: { academyId: fx.academyId, username: `demo_test_norate_pay_${randomUUID().slice(0, 8)}`, displayName: "Demo Test no rate", passwordHash: "x", role: "TEACHER", timezone: "Africa/Cairo", isActive: true, mustChangePassword: false },
      select: { id: true },
    });
    const teacher = await prisma.teacher.create({ data: { userId: user.id, academyId: fx.academyId }, select: { id: true } });
    const noRate = await adjust(fx.adminUserId, adjustment({ teacherId: teacher.id }));
    expect(noRate.status).toBe(409);
    expect(noRate.body.error.code).toBe("NO_TEACHER_RATE");
    // payroll_ledger.amount_minor is a 32-bit integer: an amount it cannot hold is a
    // clean validation error, never a server error.
    const huge = await adjust(fx.adminUserId, adjustment({ amountMinor: 3_000_000_000 }));
    expect(huge.status).toBe(400);
    const hugeDisbursement = await disburse(fx.adminUserId, { teacherId: fx.teacherProfileId, amountMinor: 3_000_000_000, currency: "EGP", reason: "too big" });
    expect(hugeDisbursement.status).toBe(400);
  });

  it("PAY-06: Supervisor, teacher and student get 403; another academy's teacher is 404 — nothing written", async () => {
    const before = await prisma.payrollLedger.count({ where: { academyId: fx.academyId } });
    for (const actor of [fx.supervisorUserId, fx.teacherUserId, fx.studentUserIds.student1]) {
      expect((await adjust(actor, adjustment())).status).toBe(403);
      expect((await disburse(actor, { teacherId: fx.teacherProfileId, amountMinor: 100, currency: "EGP", reason: "x payout" })).status).toBe(403);
    }
    expect((await adjust(fx.adminUserId, adjustment({ teacherId: fx.foreignTeacherProfileId }))).status).toBe(404);
    expect(await prisma.payrollLedger.count({ where: { academyId: fx.academyId } })).toBe(before);
  });

  it("PAY-07: a disbursement is stored NEGATIVE (money leaving the balance); a negative input is refused", async () => {
    const paid = await disburse(fx.adminUserId, { teacherId: fx.teacherProfileId, amountMinor: 5000, currency: "EGP", reason: "Demo test payout" });
    expect(paid.status).toBe(201);
    expect(paid.body.data.amountMinor).toBe(-5000);
    expect(paid.body.data.entryType).toBe("DISBURSEMENT");
    expect((await disburse(fx.adminUserId, { teacherId: fx.teacherProfileId, amountMinor: -5000, currency: "EGP", reason: "negative" })).status).toBe(400);
  });

  it("PAY-08: payroll_ledger is append-only — UPDATE and DELETE are refused by the database", async () => {
    const row = await adjust(fx.adminUserId, adjustment({ amountMinor: 42 }));
    await expect(prisma.payrollLedger.update({ where: { id: row.body.data.id }, data: { amountMinor: 43 } })).rejects.toThrow();
    await expect(prisma.payrollLedger.delete({ where: { id: row.body.data.id } })).rejects.toThrow();
    expect((await prisma.payrollLedger.findUniqueOrThrow({ where: { id: row.body.data.id } })).amountMinor).toBe(42);
  });

  it("PAY-09: per-minute pay rounds half-up to the integer minor unit (CONTEXT §7)", () => {
    expect(creditAmountMinor(60, 6000)).toBe(6000);
    expect(creditAmountMinor(1, 30)).toBe(1); // 0.5 → 1
    expect(creditAmountMinor(1, 29)).toBe(0); // 0.483 → 0
    expect(creditAmountMinor(45, 6001)).toBe(4501); // 4500.75 → 4501
    expect(creditAmountMinor(7, 6000)).toBe(700);
    expect(Number.isInteger(creditAmountMinor(37, 1234))).toBe(true);
  });
});

describe("Overtime decisions (A3: claim + ledger in one transaction)", () => {
  it("OT-01: approving a pending claim writes ONE adjustment at the per-minute rate, linked to the report, and notifies the teacher", async () => {
    const report = await overtimeReport({ minutes: 15 });
    const { status, body } = await decideOvertime(fx.adminUserId, report.id, "APPROVE");
    expect(status).toBe(200);
    expect(body.data.extraTimeStatus).toBe("APPROVED");
    const rows = await prisma.payrollLedger.findMany({ where: { reportId: report.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entryType: "ADMIN_ADJUSTMENT", amountMinor: 1500, minutesCredited: 15, hourlyRateSnapshotMinor: 6000, currency: "EGP", createdById: fx.adminUserId });
    expect(await prisma.notificationJob.count({ where: { kind: "OVERTIME_DECISION", dedupKey: `OVERTIME_DECISION:${report.id}:APPROVE` } })).toBe(1);
  });

  it("OT-02: a second approval and two concurrent approvals still write ONE entry", async () => {
    const report = await overtimeReport({ minutes: 10 });
    const results = await Promise.all([decideOvertime(fx.adminUserId, report.id, "APPROVE"), decideOvertime(fx.adminUserId, report.id, "APPROVE")]);
    expect(results.every((result) => result.status === 200)).toBe(true);
    const again = await decideOvertime(fx.adminUserId, report.id, "APPROVE");
    expect(again.body.alreadyHandled).toBe(true);
    expect(await prisma.payrollLedger.count({ where: { reportId: report.id } })).toBe(1);
  });

  it("OT-03: a rejected claim writes nothing; a SUBMITTED report is refused 409 REPORT_NOT_APPROVED", async () => {
    const rejected = await overtimeReport({ minutes: 20 });
    expect((await decideOvertime(fx.adminUserId, rejected.id, "REJECT")).body.data.extraTimeStatus).toBe("REJECTED");
    expect(await prisma.payrollLedger.count({ where: { reportId: rejected.id } })).toBe(0);
    const submitted = await overtimeReport({ status: "SUBMITTED" });
    const refused = await decideOvertime(fx.adminUserId, submitted.id, "APPROVE");
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("REPORT_NOT_APPROVED");
  });

  it("OT-04: a Supervisor gets 403 (never moves money)", async () => {
    const report = await overtimeReport();
    expect((await decideOvertime(fx.supervisorUserId, report.id, "APPROVE")).status).toBe(403);
    expect(await prisma.payrollLedger.count({ where: { reportId: report.id } })).toBe(0);
  });

  it("OT-05: with no teacher rate the approval rolls back — the claim stays PENDING and nothing is written", async () => {
    const user = await prisma.user.create({
      data: { academyId: fx.academyId, username: `demo_test_norate_ot_${randomUUID().slice(0, 8)}`, displayName: "Demo Test no rate OT", passwordHash: "x", role: "TEACHER", timezone: "Africa/Cairo", isActive: true, mustChangePassword: false },
      select: { id: true },
    });
    const teacher = await prisma.teacher.create({ data: { userId: user.id, academyId: fx.academyId }, select: { id: true } });
    const report = await overtimeReport({ teacherProfileId: teacher.id });
    const result = await decideOvertime(fx.adminUserId, report.id, "APPROVE");
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("NO_TEACHER_RATE");
    expect((await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).extraTimeStatus).toBe("PENDING");
    expect(await prisma.payrollLedger.count({ where: { reportId: report.id } })).toBe(0);
  });
});
