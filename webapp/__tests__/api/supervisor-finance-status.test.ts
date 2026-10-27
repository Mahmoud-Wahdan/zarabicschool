jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

import { getServerSession } from "next-auth";

import { GET as profilesRoute } from "../../app/api/admin/profiles/route";
import { canActOnStudentFinance } from "../../lib/guards/finance-access";
import { getStudentFinanceStatus } from "../../lib/billing/student-finance-status";
import { prisma } from "../../lib/prisma";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
  writeInitialPurchase,
} from "../helpers/session-fixtures";

/**
 * S-09 / D11 + D29 (owner, 2026-10-27): the Supervisor sees, per student, the
 * remaining sessions (credit left in the ACTIVE package(s) minus RESERVED) and the
 * paid/unpaid status (latest invoice status: PAID / PENDING / FAILED / CANCELLED) —
 * never an amount. It is a separate read model; `canActOnStudentFinance` is
 * unchanged (the Supervisor still cannot ACT on finance). Per-run test academy only.
 */
jest.setTimeout(180_000);

const getServerSessionMock = getServerSession as jest.Mock;
const MONEY_KEY = /amount|minor|currency|price|total|rate|paid_?at|sessionsPurchased/i;
let fx: SessionFixtures;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

async function subscription(studentId: string, status: "ACTIVE" | "EXPIRED", sessions: number) {
  const row = await prisma.subscription.create({
    data: {
      academyId: fx.academyId,
      studentId,
      packageType: "MONTHLY_PLAN",
      sessionsPurchased: sessions,
      totalAmountMinor: BigInt(100000),
      currency: "EGP",
      status,
      periodStartsAt: new Date(Date.now() - 24 * 3600 * 1000),
      periodEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
    select: { id: true },
  });
  await writeInitialPurchase({ academyId: fx.academyId, subscriptionId: row.id, sessionsDelta: sessions });
  return row.id;
}

async function reserve(studentId: string, subscriptionId: string) {
  const session = await prisma.session.create({
    data: {
      academyId: fx.academyId,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
      sessionType: "PRIVATE",
      scheduledStart: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      scheduledEnd: new Date(Date.now() + 3 * 24 * 3600 * 1000 + 3600 * 1000),
      durationMinutes: 60,
      timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/345678901234",
      createdById: fx.adminUserId,
      students: { create: [{ studentId }] },
    },
    select: { id: true },
  });
  await prisma.sessionReservation.create({ data: { academyId: fx.academyId, sessionId: session.id, studentId, subscriptionId } });
}

async function invoice(studentId: string, status: "PAID" | "PENDING" | "FAILED" | "CANCELLED", createdAt: Date) {
  await prisma.invoice.create({
    data: {
      academyId: fx.academyId,
      studentId,
      amountMinor: BigInt(80000),
      currency: "EGP",
      provider: "PAYMOB",
      packageType: "MONTHLY_PLAN",
      sessionsPurchased: 8,
      status,
      createdAt,
      ...(status === "PAID" ? { paidAt: createdAt } : {}),
    },
  });
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      keys.push(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-09 Supervisor finance visibility (D29)", () => {
  it("SFV-01: remaining = ACTIVE package credit minus RESERVED; an expired package does not count", async () => {
    const student = fx.studentProfileIds.student3;
    const active = await subscription(student, "ACTIVE", 8);
    await subscription(student, "EXPIRED", 4);
    await reserve(student, active);
    const status = await getStudentFinanceStatus(fx.academyId, [student]);
    expect(status.get(student)?.remainingSessions).toBe(7);
  });

  it("SFV-02: paid/unpaid = the latest invoice status; no invoice → null; another academy's data is never read", async () => {
    const student = fx.studentProfileIds.student4;
    await invoice(student, "PAID", new Date(Date.now() - 10 * 24 * 3600 * 1000));
    await invoice(student, "PENDING", new Date(Date.now() - 24 * 3600 * 1000));
    const status = await getStudentFinanceStatus(fx.academyId, [student, fx.studentProfileIds.student5]);
    expect(status.get(student)).toEqual({ remainingSessions: 0, paymentStatus: "PENDING" });
    expect(status.get(fx.studentProfileIds.student5)).toEqual({ remainingSessions: 0, paymentStatus: null });
    const foreign = await getStudentFinanceStatus(fx.foreignAcademyId, [student]);
    expect(foreign.get(student)).toEqual({ remainingSessions: 0, paymentStatus: null });
  });

  it("SFV-03: the Supervisor's student list carries the status and no money field anywhere", async () => {
    asActor(fx.supervisorUserId);
    const response = await profilesRoute(new Request("http://localhost:3000/api/admin/profiles?type=student"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    const row = payload.data.find((item: { studentProfile?: { id: string } }) => item.studentProfile?.id === fx.studentProfileIds.student4);
    expect(row.financeStatus).toEqual({ remainingSessions: 0, paymentStatus: "PENDING" });
    expect(Object.keys(row.financeStatus).sort()).toEqual(["paymentStatus", "remainingSessions"]);
    expect(collectKeys(payload).filter((key) => MONEY_KEY.test(key))).toEqual([]);
  });

  it("SFV-04: guardian and teacher lists carry no finance status", async () => {
    asActor(fx.adminUserId);
    for (const type of ["guardian", "teacher"]) {
      const response = await profilesRoute(new Request(`http://localhost:3000/api/admin/profiles?type=${type}`));
      const payload = await response.json();
      expect(collectKeys(payload)).not.toContain("financeStatus");
    }
  });

  it("SFV-05: canActOnStudentFinance is unchanged — the Supervisor still cannot act on finance", () => {
    const student = { userId: "u1", guardianId: null, isAdult: true, guardian: null };
    expect(canActOnStudentFinance({ id: "s", role: "SUPERVISOR" }, student)).toBe(false);
    expect(canActOnStudentFinance({ id: "a", role: "ADMIN" }, student)).toBe(true);
  });
});
