/**
 * E2E data fixture. Creates ONE per-run test academy ("Zarabicschool Test <8hex>",
 * the same helper the Jest suites use) plus the rows the browser specs need, and
 * writes every id/username to e2e/.run/fixture.json. Never touches the seed academy
 * except to remove the one public application the apply spec files there (matched
 * by the per-run marker).
 *
 *   npx tsx --require ./scripts/perf/server-only-shim.cjs e2e/support/fixture.ts create
 *   npx tsx --require ./scripts/perf/server-only-shim.cjs e2e/support/fixture.ts cleanup
 *
 * Phones: every fixture user gets a fictional +1-202-555-01xx number, so even a
 * production start with a linked OpenWA session cannot message a real person.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  writeInitialPurchase,
  type SessionFixtures,
} from "../../__tests__/helpers/session-fixtures";
import { reserveCredit } from "../../lib/credits/reservation";
import { prisma } from "../../lib/prisma";

export const FIXTURE_FILE = process.env.E2E_FIXTURE ?? "e2e/.run/fixture.json";
export const FIXTURE_PASSWORD = "Demo-Test-Pass-1!";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

async function grantCredit(fx: SessionFixtures, studentId: string, sessions: number) {
  const subscription = await prisma.subscription.create({
    data: {
      academyId: fx.academyId,
      studentId,
      packageType: "MONTHLY_PLAN",
      sessionsPurchased: sessions,
      totalAmountMinor: BigInt(100000),
      currency: "EGP",
      status: "ACTIVE",
      periodStartsAt: new Date(Date.now() - DAY),
      periodEndsAt: new Date(Date.now() + 30 * DAY),
    },
    select: { id: true },
  });
  await writeInitialPurchase({ academyId: fx.academyId, subscriptionId: subscription.id, sessionsDelta: sessions });
}

/** A session with its roster and credit reservations, written the way the booking path does. */
async function createSession(fx: SessionFixtures, input: { start: Date; minutes: number; studentIds: string[]; zoom: string }) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.session.create({
      data: {
        academyId: fx.academyId,
        teacherId: fx.teacherProfileId,
        subjectId: fx.subjectId,
        sessionType: input.studentIds.length > 1 ? "GROUP" : "PRIVATE",
        scheduledStart: input.start,
        scheduledEnd: new Date(input.start.getTime() + input.minutes * 60_000),
        durationMinutes: input.minutes,
        timezone: "Africa/Cairo",
        zoomJoinUrl: input.zoom,
        createdById: fx.adminUserId,
        status: "SCHEDULED",
        students: { create: input.studentIds.map((studentId) => ({ studentId })) },
      },
      select: { id: true },
    });
    for (const studentId of input.studentIds) {
      if (!(await reserveCredit(tx, fx.academyId, studentId, session.id, input.start))) {
        throw new Error("fixture: no credit to reserve");
      }
    }
    return session.id;
  });
}

async function create() {
  mkdirSync(dirname(FIXTURE_FILE), { recursive: true });
  const fx = await createSessionFixtures();
  const marker = `e2e${fx.suffix}`;
  // Written first, so a failure below can still be cleaned up with "cleanup".
  writeFileSync(FIXTURE_FILE, JSON.stringify({ fixtures: fx, marker }));

  // Fictional phones only (555-0100..0199 is reserved for fiction).
  const users = await prisma.user.findMany({
    where: { academyId: { in: [fx.academyId, fx.foreignAcademyId] } },
    select: { id: true },
    orderBy: { username: "asc" },
  });
  for (const [index, user] of users.entries()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { phone: `+1202555${String(150 + index).padStart(4, "0")}` },
    });
  }

  const s = fx.studentProfileIds;
  // student12: an adult who pays for themselves (no guardian) — Session 1 §5.2 scenario B.
  await prisma.student.update({ where: { id: s.student12 }, data: { guardianId: null, isAdult: true } });
  // student1: report language French, family UI Arabic — Session 1 §5.1.
  await prisma.student.update({ where: { id: s.student1 }, data: { reportLanguage: "fr" } });
  await prisma.user.update({ where: { id: fx.guardianUserId }, data: { preferredLanguage: "ar" } });
  await prisma.user.update({ where: { id: fx.teacherUserId }, data: { preferredLanguage: "en" } });
  // A user who must change the Admin-set password at the next login (A07 forced change).
  await prisma.user.update({ where: { id: fx.studentUserIds.student8 }, data: { mustChangePassword: true } });

  for (const key of ["student1", "student2", "student3", "student4"] as const) await grantCredit(fx, s[key], 10);

  const now = Date.now();
  const zoom = (n: number) => `https://zoom.us/j/${String(700000000 + n)}`;
  // Ended today: a teacher can report on these.
  const reportSession = await createSession(fx, { start: new Date(now - 3 * HOUR), minutes: 60, studentIds: [s.student1], zoom: zoom(1) });
  const approvalSession = await createSession(fx, { start: new Date(now - 5 * HOUR), minutes: 60, studentIds: [s.student2], zoom: zoom(2) });
  const absentSession = await createSession(fx, { start: new Date(now - 7 * HOUR), minutes: 60, studentIds: [s.student3], zoom: zoom(3) });
  // Starting in a few minutes (inside the default join window) and in two days.
  const soonSession = await createSession(fx, { start: new Date(now + 5 * 60_000), minutes: 60, studentIds: [s.student1], zoom: zoom(4) });
  const futureSession = await createSession(fx, { start: new Date(now + 2 * DAY), minutes: 60, studentIds: [s.student2], zoom: zoom(5) });

  const pendingInvoice = (studentId: string, amountMinor = 80000, sessionsPurchased = 8) =>
    prisma.invoice.create({
      data: {
        academyId: fx.academyId,
        studentId,
        amountMinor: BigInt(amountMinor),
        currency: "EGP",
        provider: "PAYMOB",
        packageType: "MONTHLY_PLAN",
        sessionsPurchased,
        status: "PENDING",
      },
      select: { id: true },
    });
  // The checkout spec pays the 800.00 one; the 500.00 one stays pending for the finance-wall spec.
  const adultInvoice = await pendingInvoice(s.student12);
  const adultSpareInvoice = await pendingInvoice(s.student12, 50000, 4);
  const familyInvoice = await pendingInvoice(s.student1);

  const application = await prisma.application.create({
    data: {
      academyId: fx.academyId,
      applicationType: "STUDENT",
      contactPhone: "+12025550198",
      details: {
        type: "STUDENT",
        full_name: `Applicant ${marker}`,
        phone_whatsapp: "+12025550198",
        timezone: "Africa/Cairo",
        preferred_language: "en",
        date_of_birth: "1995-05-15",
        subjects: [`demo-test-${fx.suffix}`],
        level: "beginner",
      },
    },
    select: { id: true },
  });

  const byId = await prisma.user.findMany({
    where: { academyId: { in: [fx.academyId, fx.foreignAcademyId] } },
    select: { id: true, username: true },
  });
  const username = (id: string) => byId.find((user) => user.id === id)!.username;

  writeFileSync(
    FIXTURE_FILE,
    JSON.stringify(
      {
        fixtures: fx,
        marker,
        password: FIXTURE_PASSWORD,
        users: {
          admin: username(fx.adminUserId),
          supervisor: username(fx.supervisorUserId),
          teacher: username(fx.teacherUserId),
          teacher2: username(fx.teacher2UserId),
          guardian: username(fx.guardianUserId),
          student: username(fx.studentUserIds.student1),
          student2: username(fx.studentUserIds.student2),
          adult: username(fx.studentUserIds.student12),
          mustChange: username(fx.studentUserIds.student8),
          rateLimited: username(fx.studentUserIds.student9),
          foreignAdmin: username(fx.foreignAdminUserId),
        },
        ids: {
          reportSession,
          approvalSession,
          absentSession,
          soonSession,
          futureSession,
          adultInvoice: adultInvoice.id,
          adultSpareInvoice: adultSpareInvoice.id,
          familyInvoice: familyInvoice.id,
          application: application.id,
        },
      },
      null,
      2,
    ),
  );
  console.log(`e2e fixture written to ${FIXTURE_FILE}`);
}

async function cleanup() {
  const { fixtures, marker } = JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as { fixtures: SessionFixtures; marker: string };
  // The public apply spec files into the seed academy: remove only this run's row.
  await prisma.application.deleteMany({ where: { details: { path: ["full_name"], string_contains: marker } } });
  await cleanupSessionFixtures(fixtures);
  console.log("e2e fixture removed");
}

(process.argv[2] === "cleanup" ? cleanup() : create())
  .catch((cause) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  })
  .finally(() => closePrisma());
