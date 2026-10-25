/**
 * Read-only DB preflight/cleanup verification helper (test support only — never
 * imported by app code). Reports:
 *  - demo_* seeded accounts per role (Playwright prerequisites)
 *  - leftover rows linked to `demo_test_*` test academies per touched table
 *
 * Run from webapp/: npx tsx __tests__/helpers/db-stats.ts
 */
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env" });

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../../generated/prisma/client";

type Count = { count: number };

const directUrl = process.env.DIRECT_URL;
if (!directUrl) throw new Error("DIRECT_URL is required.");
const pool = new Pool({ connectionString: directUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function testAcademyIds(): Promise<string[]> {
  // Test fixtures create academies named "Zarabicschool Test <uuid-suffix>" and
  // users `demo_test_<key>_<suffix>`; both mark the same per-run academy set.
  const byName = await prisma.academy.findMany({
    where: { name: { startsWith: "Zarabicschool Test" } },
    select: { id: true },
  });
  const byUser = await prisma.academy.findMany({
    where: { users: { some: { username: { startsWith: "demo_test_" } } } },
    select: { id: true },
  });
  return [...new Set([...byName.map((a) => a.id), ...byUser.map((a) => a.id)])];
}

async function main() {
  const academyIds = await testAcademyIds();
  const scope = academyIds.length ? { academyId: { in: academyIds } } : null;
  const inAcademies = { academyId: { in: academyIds } };

  const roleCounts = await prisma.user.groupBy({
    by: ["role"],
    where: { username: { startsWith: "demo_" } },
    _count: { _all: true },
  });
  console.log(
    "demo_* seeded users by role:",
    JSON.stringify(roleCounts.map((r) => ({ role: r.role, count: r._count._all }))),
  );

  for (const username of ["demo_supervisor", "demo_teacher_quran", "demo_student", "demo_student_adult", "demo_guardian"]) {
    const user = await prisma.user.findFirst({ where: { username }, select: { role: true } });
    console.log(`demo account ${username}: ${user ? user.role : "MISSING"}`);
  }
  const adminCount = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
  console.log(`active ADMIN accounts in DB: ${adminCount}`);

  const stats: Record<string, number> = {};
  stats.academies = academyIds.length;
  stats.users = await prisma.user.count({ where: { username: { startsWith: "demo_test_" } } });
  stats.students = scope ? await prisma.student.count({ where: scope }) : 0;
  stats.guardians = scope ? await prisma.guardian.count({ where: scope }) : 0;
  stats.teachers = scope ? await prisma.teacher.count({ where: scope }) : 0;
  stats.subjects = scope ? await prisma.subject.count({ where: scope }) : 0;
  stats.teacherRates = scope ? await prisma.teacherRate.count({ where: scope }) : 0;
  stats.teacherFlags = scope ? await prisma.teacherFlag.count({ where: scope }) : 0;
  stats.notificationJobs = scope ? await prisma.notificationJob.count({ where: scope }) : 0;
  // webhook_events has no academy_id — tests give provider_event_id a demo_test_ prefix.
  stats.webhookEvents = await prisma.webhookEvent.count({ where: { providerEventId: { startsWith: "demo_test_" } } });
  stats.paymentProofs = scope ? await prisma.paymentProof.count({ where: scope }) : 0;
  stats.invoices = scope ? await prisma.invoice.count({ where: scope }) : 0;
  stats.paymentAttempts = academyIds.length ? await prisma.paymentAttempt.count({ where: { invoice: inAcademies } }) : 0;
  stats.subscriptions = scope ? await prisma.subscription.count({ where: scope }) : 0;
  stats.subscriptionLedger = scope ? await prisma.subscriptionLedger.count({ where: scope }) : 0;
  stats.payrollLedger = scope ? await prisma.payrollLedger.count({ where: scope }) : 0;
  stats.sessionReservations = scope ? await prisma.sessionReservation.count({ where: scope }) : 0;
  stats.monthlyReports = scope ? await prisma.monthlyReport.count({ where: scope }) : 0;
  stats.reports = scope ? await prisma.report.count({ where: scope }) : 0;
  stats.reportAttachments = scope ? await prisma.reportAttachment.count({ where: scope }) : 0;
  stats.sessions = scope ? await prisma.session.count({ where: scope }) : 0;
  stats.sessionStudents = academyIds.length ? await prisma.sessionStudent.count({ where: { session: inAcademies } }) : 0;
  stats.academySettings = scope ? await prisma.academySetting.count({ where: scope }) : 0;

  console.log("demo_test_* leftovers per table:", JSON.stringify(stats));

  const stray = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM users WHERE username LIKE 'demo_test_%'
     AND academy_id NOT IN (SELECT id FROM academies WHERE name LIKE 'Zarabicschool Test%')`,
  )) as Count[];
  console.log("stray demo_test_ users outside test academies:", stray[0]?.count ?? 0);

  await prisma.$disconnect();
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
