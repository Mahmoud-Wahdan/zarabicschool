import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bucketRevenue, getEgpRevenue, getHomeCounts, parsePeriod } from "../../lib/finance/revenue";
import { prisma } from "../../lib/prisma";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * S-11 / D8 Admin home (owner, 2026-10-27): cards (active students, active teachers,
 * sessions this week) + an EGP-only revenue chart (PAID invoices by the month they
 * were paid in the viewer's zone), monthly with quarterly and half-year aggregation.
 * No dollar conversion. Admin only. Per-run test academy only.
 */
jest.setTimeout(180_000);

const CAIRO = "Africa/Cairo";
let fx: SessionFixtures;

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-11 Admin home (D8)", () => {
  it("HM-01: buckets are calendar months in the viewer's zone; quarters and half-years sum their months", () => {
    const rows = [
      { paidAt: new Date("2026-09-30T22:30:00Z"), amountMinor: BigInt(1000) }, // 1 Oct 01:30 Cairo
      { paidAt: new Date("2026-09-15T10:00:00Z"), amountMinor: BigInt(500) },
      { paidAt: new Date("2026-12-31T21:30:00Z"), amountMinor: BigInt(200) }, // 31 Dec 23:30 Cairo
      { paidAt: new Date("2026-04-02T10:00:00Z"), amountMinor: BigInt(300) },
    ];
    const months = bucketRevenue(rows, "month", "2026-12", CAIRO);
    expect(months).toHaveLength(12);
    expect(months.at(-1)).toEqual({ key: "2026-12", totalMinor: BigInt(200) });
    expect(months.find((bucket) => bucket.key === "2026-10")?.totalMinor).toBe(BigInt(1000));
    expect(months.find((bucket) => bucket.key === "2026-09")?.totalMinor).toBe(BigInt(500));
    const quarters = bucketRevenue(rows, "quarter", "2026-12", CAIRO);
    expect(quarters.map((bucket) => bucket.key)).toEqual(["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
    expect(quarters.map((bucket) => bucket.totalMinor)).toEqual([BigInt(0), BigInt(300), BigInt(500), BigInt(1200)]);
    const halves = bucketRevenue(rows, "half", "2026-12", CAIRO);
    expect(halves.map((bucket) => [bucket.key, bucket.totalMinor])).toEqual([
      ["2025-H1", BigInt(0)], ["2025-H2", BigInt(0)], ["2026-H1", BigInt(300)], ["2026-H2", BigInt(1700)],
    ]);
    expect(parsePeriod("quarter")).toBe("quarter");
    expect(parsePeriod("weekly")).toBe("month");
  });

  it("HM-02: EGP and PAID only, this academy only — USD, pending and foreign invoices never count", async () => {
    const paidAt = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    const base = { provider: "PAYMOB" as const, packageType: "MONTHLY_PLAN" as const, sessionsPurchased: 8 };
    await prisma.invoice.createMany({
      data: [
        { ...base, academyId: fx.academyId, studentId: fx.studentProfileIds.student1, amountMinor: BigInt(80000), currency: "EGP", status: "PAID", paidAt },
        { ...base, academyId: fx.academyId, studentId: fx.studentProfileIds.student2, amountMinor: BigInt(5000), currency: "USD", status: "PAID", paidAt },
        { ...base, academyId: fx.academyId, studentId: fx.studentProfileIds.student3, amountMinor: BigInt(70000), currency: "EGP", status: "PENDING" },
        { ...base, academyId: fx.foreignAcademyId, studentId: fx.foreignStudentProfileId, amountMinor: BigInt(90000), currency: "EGP", status: "PAID", paidAt },
      ],
    });
    const buckets = await getEgpRevenue(fx.academyId, "month", new Date(), CAIRO);
    const total = buckets.reduce((sum, bucket) => sum + bucket.totalMinor, BigInt(0));
    expect(total).toBe(BigInt(80000));
  });

  it("HM-03: home counts — active students and teachers, and this week's held or scheduled sessions (viewer zone)", async () => {
    const counts = await getHomeCounts(fx.academyId, new Date(), CAIRO);
    const students = await prisma.student.count({ where: { academyId: fx.academyId, user: { isActive: true } } });
    const teachers = await prisma.teacher.count({ where: { academyId: fx.academyId, user: { isActive: true } } });
    expect(counts.students).toBe(students);
    expect(counts.teachers).toBe(teachers);
    const before = counts.sessionsThisWeek;
    const start = new Date(Date.now() + 3600 * 1000);
    await prisma.session.create({
      data: {
        academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
        scheduledStart: start, scheduledEnd: new Date(start.getTime() + 3600 * 1000), durationMinutes: 60, timezone: CAIRO,
        zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status: "CANCELLED",
        students: { create: [{ studentId: fx.studentProfileIds.student4 }] },
      },
    });
    expect((await getHomeCounts(fx.academyId, new Date(), CAIRO)).sessionsThisWeek).toBe(before);
  });

  it("HM-04 (static): the revenue chart lives on the Admin home only; the Supervisor home never loads money", () => {
    const admin = readFileSync(join(process.cwd(), "app/[locale]/admin/page.tsx"), "utf8");
    expect(admin).toMatch(/requireRole\("ADMIN"\)/);
    expect(admin).toMatch(/<RevenueChart/);
    const supervisor = readFileSync(join(process.cwd(), "app/[locale]/supervisor/page.tsx"), "utf8");
    expect(supervisor).not.toMatch(/RevenueChart|getEgpRevenue|amountMinor/);
  });
});
