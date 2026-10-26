// =============================================================================
// DEMO SEED (rewritten 2026-10-25, Session 5) — DEV DATABASE ONLY.
//
// Run once on an EMPTY database (after `prisma migrate reset`):  npm run db:seed:demo
//
// Rules (owner, 2026-10-25):
// - Every password comes from env: SEED_ADMIN_PASSWORD (Admin), SEED_DEMO_PASSWORD
//   (all demo_* users). No literal, no shared default in code. Nothing is printed.
// - Every phone is FAKE (fictional +1-202-555-01xx range) except two read from env
//   at seed time: SEED_TEST_PHONE_GUARDIAN (demo_guardian) and
//   SEED_TEST_PHONE_TEACHER (demo_teacher). They are never written to code or docs.
// - Money rows mirror the real code paths, each in ONE transaction:
//   paid invoice = invoice PAID + attempt SUCCEEDED + subscription + INITIAL_PURCHASE
//   + payment_audit (lib/payments/settlement.ts); approved report = APPROVED +
//   settled/archived markers + attendance + reservation + SESSION_DEDUCTION
//   (attended only) + one SESSION_CREDIT per session (lib/reports/settlement-seam.ts).
//   No approved report without settlement.
// - A session is COMPLETED only when every roster student has a report (CONTEXT §7).
// - No PENDING notification jobs and no future reminder jobs are seeded, so the
//   worker never messages anyone because of this seed. Outside production the
//   OpenWA adapter only sends to OPENWA_SEND_ALLOWLIST anyway.
// - Settings: only keys the code reads (billing.pay_per_session.min/max). The
//   class-remark list is NOT seeded: the code default (report.class_remarks) applies.
// =============================================================================

import "dotenv/config";

import bcrypt from "bcrypt";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { Prisma, PrismaClient } from "../generated/prisma/client";

const DAY = 24 * 60 * 60 * 1000;
const TIMEZONE = "Africa/Cairo";
const ACADEMY_NAME = "Zarabicschool";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the demo seed.`);
  return value;
}

/** Same rounding as lib/payroll/rates.ts creditAmountMinor (half-up to the minor unit). */
function creditAmountMinor(minutes: number, hourlyRateMinor: number): number {
  return Math.floor((minutes * hourlyRateMinor + 30) / 60);
}

let fakePhoneCounter = 100;
/** Fictional NANP numbers (555-0100..0199 are reserved for fiction). */
function fakePhone(): string {
  fakePhoneCounter += 1;
  if (fakePhoneCounter > 199) throw new Error("Out of fictional phone numbers.");
  return `+1202555${String(fakePhoneCounter).padStart(4, "0")}`;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("The demo seed never runs in production.");
  const directUrl = required("DIRECT_URL");
  const adminUsername = required("SEED_ADMIN_USERNAME");
  const adminName = required("SEED_ADMIN_NAME");
  const demoPassword = required("SEED_DEMO_PASSWORD");
  // Owner decision (2026-10-25): the Admin may start with the demo password when
  // SEED_ADMIN_PASSWORD is not set. Still env-only, and the Admin is forced to
  // change it at first login (mustChangePassword below).
  const adminPassword = process.env.SEED_ADMIN_PASSWORD?.trim() || demoPassword;
  // Same minimum as the app (lib/validation/auth.ts).
  if (demoPassword.length < 8) throw new Error("SEED_DEMO_PASSWORD must be at least 8 characters.");
  const guardianTestPhone = required("SEED_TEST_PHONE_GUARDIAN");
  const teacherTestPhone = required("SEED_TEST_PHONE_TEACHER");

  const pool = new Pool({ connectionString: directUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    if ((await prisma.user.count()) > 0) {
      throw new Error("The database is not empty. Run `prisma migrate reset` first (dev only).");
    }
    const now = new Date();
    const at = (days: number, hour = 17) => {
      const date = new Date(now.getTime() + days * DAY);
      date.setUTCHours(hour - 3, 0, 0, 0); // Cairo wall clock (UTC+3 in summer time)
      return date;
    };

    const academy = await prisma.academy.create({ data: { name: ACADEMY_NAME } });
    const academyId = academy.id;

    // ---- Users -------------------------------------------------------------
    const admin = await prisma.user.create({
      data: {
        academyId,
        username: adminUsername,
        displayName: adminName,
        passwordHash: await bcrypt.hash(adminPassword, 12),
        role: "ADMIN",
        mustChangePassword: true,
        phone: fakePhone(),
      },
    });
    const demoHash = await bcrypt.hash(demoPassword, 12);
    const makeUser = (input: {
      username: string;
      displayName: string;
      role: "SUPERVISOR" | "TEACHER" | "GUARDIAN" | "STUDENT";
      phone?: string | null;
      timezone?: string;
      preferredLanguage?: string;
      mustChangePassword?: boolean;
    }) =>
      prisma.user.create({
        data: {
          academyId,
          username: input.username,
          displayName: input.displayName,
          passwordHash: demoHash,
          role: input.role,
          phone: input.phone === undefined ? fakePhone() : input.phone,
          timezone: input.timezone ?? TIMEZONE,
          preferredLanguage: input.preferredLanguage ?? "ar",
          mustChangePassword: input.mustChangePassword ?? false,
        },
      });

    await makeUser({ username: "demo_supervisor", displayName: "Demo Supervisor", role: "SUPERVISOR" });

    const teacherUser = await makeUser({ username: "demo_teacher", displayName: "Demo Teacher", role: "TEACHER", phone: teacherTestPhone });
    const quranTeacherUser = await makeUser({ username: "demo_teacher_quran", displayName: "Demo Quran Teacher", role: "TEACHER" });
    const langTeacherUser = await makeUser({
      username: "demo_teacher_lang",
      displayName: "Demo Language Teacher",
      role: "TEACHER",
      mustChangePassword: true, // exercises the forced-password-change journey
    });

    const guardianUser = await makeUser({ username: "demo_guardian", displayName: "Demo Guardian", role: "GUARDIAN", phone: guardianTestPhone });
    const guardian2User = await makeUser({
      username: "demo_guardian_2",
      displayName: "Demo Guardian Two",
      role: "GUARDIAN",
      timezone: "America/New_York",
      preferredLanguage: "en",
    });

    // Minors with a guardian usually have no own phone (no WhatsApp to a child).
    const studentUser = await makeUser({ username: "demo_student", displayName: "Demo Student", role: "STUDENT", phone: null });
    const student2User = await makeUser({ username: "demo_student_2", displayName: "Demo Student Two", role: "STUDENT", phone: null });
    const student3User = await makeUser({
      username: "demo_student_3",
      displayName: "Demo Student Three",
      role: "STUDENT",
      phone: null,
      timezone: "America/New_York",
      preferredLanguage: "en",
    });
    const adultUser = await makeUser({ username: "demo_student_adult", displayName: "Demo Adult Student", role: "STUDENT" });
    const zeroUser = await makeUser({ username: "demo_student_zero", displayName: "Demo Student No Credit", role: "STUDENT" });

    // ---- Profiles ------------------------------------------------------------
    const teacher = await prisma.teacher.create({ data: { academyId, userId: teacherUser.id } });
    const quranTeacher = await prisma.teacher.create({ data: { academyId, userId: quranTeacherUser.id } });
    const langTeacher = await prisma.teacher.create({ data: { academyId, userId: langTeacherUser.id } });
    const guardian = await prisma.guardian.create({ data: { academyId, userId: guardianUser.id, relationship: "MOTHER" } });
    const guardian2 = await prisma.guardian.create({ data: { academyId, userId: guardian2User.id, relationship: "FATHER" } });
    const student = await prisma.student.create({ data: { academyId, userId: studentUser.id, guardianId: guardian.id } });
    const student2 = await prisma.student.create({ data: { academyId, userId: student2User.id, guardianId: guardian.id } });
    const student3 = await prisma.student.create({
      data: { academyId, userId: student3User.id, guardianId: guardian2.id, reportLanguage: "en" },
    });
    const adult = await prisma.student.create({ data: { academyId, userId: adultUser.id, isAdult: true } });
    const zero = await prisma.student.create({ data: { academyId, userId: zeroUser.id, isAdult: true } });

    // ---- Subjects and relationships -------------------------------------------
    const subject = async (slug: string, nameAr: string, nameEn: string, sortOrder: number) =>
      prisma.subject.create({ data: { academyId, slug, nameAr, nameEn, sortOrder } });
    const quran = await subject("demo-quran", "القرآن الكريم", "Quran", 1);
    const arabic = await subject("demo-arabic", "اللغة العربية", "Arabic", 2);
    const english = await subject("demo-english", "اللغة الإنجليزية", "English", 3);

    const teacherSubjects: Array<[string, string]> = [
      [teacher.id, quran.id],
      [teacher.id, arabic.id],
      [quranTeacher.id, quran.id],
      [langTeacher.id, english.id],
    ];
    for (const [teacherId, subjectId] of teacherSubjects) {
      await prisma.teacherSubject.create({ data: { academyId, teacherId, subjectId } });
    }
    const assignments: Array<[string, string, string]> = [
      [student.id, teacher.id, quran.id],
      [student2.id, quranTeacher.id, quran.id],
      [student3.id, langTeacher.id, english.id],
      [adult.id, langTeacher.id, english.id],
      [zero.id, teacher.id, arabic.id],
    ];
    for (const [studentId, teacherId, subjectId] of assignments) {
      await prisma.studentSubject.create({ data: { academyId, studentId, subjectId } });
      await prisma.studentTeacherAssignment.create({ data: { academyId, studentId, teacherId, subjectId, createdById: admin.id } });
    }

    // ---- Rates, plan, settings ---------------------------------------------------
    const rateFor = new Map<string, { id: string; hourlyRateMinor: number; currency: string }>();
    for (const [teacherId, hourlyRateMinor, currency] of [
      [teacher.id, 20_000, "EGP"],
      [quranTeacher.id, 18_000, "EGP"],
      [langTeacher.id, 1_500, "USD"],
    ] as const) {
      const rate = await prisma.teacherRate.create({
        data: { academyId, teacherId, hourlyRateMinor, currency, effectiveFrom: new Date(now.getTime() - 90 * DAY), createdById: admin.id },
      });
      rateFor.set(teacherId, { id: rate.id, hourlyRateMinor, currency });
    }
    await prisma.billingPlan.create({
      data: { academyId, nameAr: "الباقة الشهرية", nameEn: "Monthly plan", packageType: "MONTHLY_PLAN", sessionsPerMonth: 8, basePriceMinor: BigInt(160_000), currency: "EGP" },
    });
    for (const [key, value] of [
      ["billing.pay_per_session.min", "1"],
      ["billing.pay_per_session.max", "16"],
    ]) {
      await prisma.academySetting.create({ data: { academyId, key, value } });
    }
    const siteNumber = process.env.SEED_SITE_WHATSAPP_NUMBER?.trim();
    if (siteNumber) {
      await prisma.academySetting.create({ data: { academyId, key: "site.whatsapp_number", value: siteNumber } });
    }

    // ---- Invoices and subscriptions -------------------------------------------
    let attemptNo = 0;
    const createInvoice = (studentId: string, packageType: "MONTHLY_PLAN" | "PAY_PER_SESSION", sessions: number, amountMinor: number) =>
      prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: { academyId, studentId, amountMinor: BigInt(amountMinor), currency: "EGP", provider: "PAYMOB", packageType, sessionsPurchased: sessions },
        });
        await tx.paymentAudit.create({
          data: { academyId, invoiceId: invoice.id, eventType: "CREATED", actorId: admin.id, actorRole: "ADMIN", metadata: { provider: "PAYMOB", amountMinor: String(amountMinor), currency: "EGP", packageType, sessionsPurchased: sessions } },
        });
        return invoice;
      });

    /** Mirrors settlePaidInvoice: ONE transaction for PAID + attempt + subscription + ledger + audit. */
    const payInvoice = (invoice: { id: string; studentId: string; packageType: "MONTHLY_PLAN" | "ANNUAL_PLAN" | "PAY_PER_SESSION"; sessionsPurchased: number; amountMinor: bigint }, paidDaysAgo: number) =>
      prisma.$transaction(async (tx) => {
        attemptNo += 1;
        const paidAt = new Date(now.getTime() - paidDaysAgo * DAY);
        const providerReference = `demo-order-${attemptNo}`;
        await tx.paymentAttempt.create({
          data: { invoiceId: invoice.id, provider: "PAYMOB", idempotencyKey: `invoice:${invoice.id}:v1`, providerReference, status: "SUCCEEDED" },
        });
        const hasPeriod = invoice.packageType !== "PAY_PER_SESSION";
        const subscription = await tx.subscription.create({
          data: {
            academyId,
            studentId: invoice.studentId,
            packageType: invoice.packageType,
            sessionsPurchased: invoice.sessionsPurchased,
            totalAmountMinor: invoice.amountMinor,
            currency: "EGP",
            periodStartsAt: hasPeriod ? paidAt : null,
            periodEndsAt: hasPeriod ? new Date(paidAt.getTime() + 30 * DAY) : null,
          },
        });
        await tx.subscriptionLedger.create({
          data: { academyId, subscriptionId: subscription.id, invoiceId: invoice.id, entryType: "INITIAL_PURCHASE", sessionsDelta: invoice.sessionsPurchased },
        });
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID", paidAt, subscriptionId: subscription.id, providerReference } });
        await tx.paymentAudit.create({
          data: { academyId, invoiceId: invoice.id, eventType: "PAID", actorRole: "WEBHOOK", metadata: { provider: "PAYMOB", providerReference, amountMinor: invoice.amountMinor.toString(), currency: "EGP" } },
        });
        return subscription;
      });

    const subStudent = await payInvoice(await createInvoice(student.id, "MONTHLY_PLAN", 8, 160_000), 15);
    const subStudent2 = await payInvoice(await createInvoice(student2.id, "PAY_PER_SESSION", 4, 90_000), 12);
    const subStudent3 = await payInvoice(await createInvoice(student3.id, "MONTHLY_PLAN", 8, 160_000), 14);
    const subAdult = await payInvoice(await createInvoice(adult.id, "PAY_PER_SESSION", 3, 67_500), 10);
    await createInvoice(student3.id, "PAY_PER_SESSION", 2, 45_000); // PENDING — guardian 2 pays
    await createInvoice(zero.id, "PAY_PER_SESSION", 4, 90_000); // PENDING — adult without credit

    // ---- Sessions ------------------------------------------------------------------
    let zoomNo = 0;
    const subscriptionOf = new Map<string, string>([
      [student.id, subStudent.id],
      [student2.id, subStudent2.id],
      [student3.id, subStudent3.id],
      [adult.id, subAdult.id],
    ]);
    const createSession = (input: {
      teacherId: string;
      subjectId: string;
      start: Date;
      minutes: number;
      studentIds: string[];
      status?: "SCHEDULED" | "COMPLETED" | "CANCELLED";
      replacementForSessionId?: string;
    }) =>
      prisma.$transaction(async (tx) => {
        zoomNo += 1;
        const cancelled = input.status === "CANCELLED";
        const session = await tx.session.create({
          data: {
            academyId,
            teacherId: input.teacherId,
            subjectId: input.subjectId,
            sessionType: input.studentIds.length > 1 ? "GROUP" : "PRIVATE",
            scheduledStart: input.start,
            scheduledEnd: new Date(input.start.getTime() + input.minutes * 60_000),
            durationMinutes: input.minutes,
            timezone: TIMEZONE,
            zoomJoinUrl: `https://zoom.us/j/9000000${String(zoomNo).padStart(3, "0")}`,
            createdById: admin.id,
            status: input.status ?? "SCHEDULED",
            replacementForSessionId: input.replacementForSessionId ?? null,
            ...(cancelled ? { cancelledById: admin.id, cancellationReason: "Demo: cancelled by the academy." } : {}),
          },
        });
        for (const studentId of input.studentIds) {
          await tx.sessionStudent.create({ data: { sessionId: session.id, studentId } });
          const subscriptionId = subscriptionOf.get(studentId);
          if (!subscriptionId) throw new Error("Seed bug: student without subscription on a roster.");
          await tx.sessionReservation.create({
            data: {
              academyId,
              sessionId: session.id,
              studentId,
              subscriptionId,
              status: cancelled ? "RELEASED" : "RESERVED",
              releasedAt: cancelled ? new Date() : null,
            },
          });
        }
        return session;
      });

    type ReportInput = {
      sessionId: string;
      studentId: string;
      teacherId: string;
      outcome: "ATTENDED" | "STUDENT_ABSENT";
      remark: string;
      summary: string;
      homework: string;
      submittedAt: Date;
      language?: "ar" | "en";
      extraTimeMinutes?: number;
    };
    const reportData = (input: ReportInput) => ({
      academyId,
      sessionId: input.sessionId,
      studentId: input.studentId,
      teacherId: input.teacherId,
      reportType: "SESSION_COMPLETION_REPORT" as const,
      attendanceOutcome: input.outcome,
      classRemark: input.remark,
      summary: input.summary,
      homework: input.homework,
      submittedAt: input.submittedAt,
      language: input.language ?? "ar",
      extraTimeMinutes: input.extraTimeMinutes ?? 0,
      extraTimeStatus: (input.extraTimeMinutes ? "PENDING" : "NONE") as "PENDING" | "NONE",
    });

    /** Mirrors the review route + settleApprovedReport: ONE transaction. */
    const submitAndApprove = (input: ReportInput, approverId: string) =>
      prisma.$transaction(async (tx) => {
        const approvedAt = new Date(input.submittedAt.getTime() + 2 * 60 * 60 * 1000);
        const report = await tx.report.create({
          data: { ...reportData(input), status: "APPROVED", approvedById: approverId, approvedAt, settledAt: approvedAt, archivedAt: approvedAt },
        });
        await tx.sessionStudent.update({
          where: { sessionId_studentId: { sessionId: input.sessionId, studentId: input.studentId } },
          data: { attendanceStatus: input.outcome },
        });
        const reservation = await tx.sessionReservation.findUniqueOrThrow({
          where: { sessionId_studentId: { sessionId: input.sessionId, studentId: input.studentId } },
        });
        if (input.outcome === "ATTENDED") {
          await tx.sessionReservation.update({ where: { id: reservation.id }, data: { status: "CONSUMED" } });
          await tx.subscriptionLedger.create({
            data: { academyId, subscriptionId: reservation.subscriptionId, sessionId: input.sessionId, reportId: report.id, entryType: "SESSION_DEDUCTION", sessionsDelta: -1 },
          });
          const existingCredit = await tx.payrollLedger.findFirst({ where: { sessionId: input.sessionId, entryType: "SESSION_CREDIT" } });
          if (!existingCredit) {
            const session = await tx.session.findUniqueOrThrow({ where: { id: input.sessionId } });
            const rate = rateFor.get(input.teacherId);
            if (!rate) throw new Error("Seed bug: teacher without rate.");
            await tx.payrollLedger.create({
              data: {
                academyId,
                teacherId: input.teacherId,
                sessionId: input.sessionId,
                reportId: report.id,
                teacherRateId: rate.id,
                entryType: "SESSION_CREDIT",
                amountMinor: creditAmountMinor(session.durationMinutes, rate.hourlyRateMinor),
                currency: rate.currency,
                minutesCredited: session.durationMinutes,
                hourlyRateSnapshotMinor: rate.hourlyRateMinor,
              },
            });
          }
        } else {
          await tx.sessionReservation.update({ where: { id: reservation.id }, data: { status: "RELEASED", releasedAt: approvedAt } });
        }
        return report;
      });

    // S1 — completed, approved + settled, overtime claim pending (Admin can review it).
    const s1 = await createSession({ teacherId: teacher.id, subjectId: quran.id, start: at(-10), minutes: 60, studentIds: [student.id], status: "COMPLETED" });
    const r1 = await submitAndApprove(
      { sessionId: s1.id, studentId: student.id, teacherId: teacher.id, outcome: "ATTENDED", remark: "excellent", summary: "مراجعة سورة الملك مع التجويد.", homework: "حفظ خمس آيات جديدة.", submittedAt: at(-10, 19), extraTimeMinutes: 15 },
      admin.id,
    );
    // S2 — completed, report SUBMITTED (approval queue).
    const s2 = await createSession({ teacherId: teacher.id, subjectId: quran.id, start: at(-7), minutes: 60, studentIds: [student.id], status: "COMPLETED" });
    const r2 = await prisma.report.create({
      data: { ...reportData({ sessionId: s2.id, studentId: student.id, teacherId: teacher.id, outcome: "ATTENDED", remark: "very_good", summary: "تسميع الصفحة الثانية.", homework: "مراجعة الصفحة الثالثة.", submittedAt: at(-7, 19) }), status: "SUBMITTED" },
    });
    // S3 — completed, report REJECTED (teacher must correct; session stays COMPLETED).
    const s3 = await createSession({ teacherId: quranTeacher.id, subjectId: quran.id, start: at(-5), minutes: 45, studentIds: [student2.id], status: "COMPLETED" });
    const r3 = await prisma.report.create({
      data: {
        ...reportData({ sessionId: s3.id, studentId: student2.id, teacherId: quranTeacher.id, outcome: "ATTENDED", remark: "good", summary: "قراءة.", homework: "مراجعة.", submittedAt: at(-5, 19) }),
        status: "REJECTED",
        rejectionReason: "Please add more detail to the summary.",
        rejectedById: admin.id,
        rejectedAt: at(-5, 21),
        rejectionCount: 1,
      },
    });
    // S4 — group, completed: one attended (deduction + the session credit), one absent (no money).
    const s4 = await createSession({ teacherId: langTeacher.id, subjectId: english.id, start: at(-3), minutes: 90, studentIds: [student3.id, adult.id], status: "COMPLETED" });
    await submitAndApprove(
      { sessionId: s4.id, studentId: student3.id, teacherId: langTeacher.id, outcome: "ATTENDED", remark: "good", summary: "Role-play: ordering at a restaurant.", homework: "Write ten new words in sentences.", submittedAt: at(-3, 20), language: "en" },
      admin.id,
    );
    const supervisor = await prisma.user.findFirstOrThrow({ where: { academyId, role: "SUPERVISOR" } });
    await submitAndApprove(
      { sessionId: s4.id, studentId: adult.id, teacherId: langTeacher.id, outcome: "STUDENT_ABSENT", remark: "acceptable", summary: "Student did not attend.", homework: "Review the shared worksheet.", submittedAt: at(-3, 20), language: "en" },
      supervisor.id,
    );
    // S5 — ended, still SCHEDULED, no report (late) — older than the 24 h late-report scan window.
    const s5 = await createSession({ teacherId: quranTeacher.id, subjectId: quran.id, start: at(-2), minutes: 45, studentIds: [student2.id] });
    await prisma.teacherFlag.create({ data: { academyId, teacherId: quranTeacher.id, sessionId: s5.id, flagType: "LATE_REPORT" } });
    // S6 — cancelled (reservation released) + S9 its replacement in the future.
    const s6 = await createSession({ teacherId: teacher.id, subjectId: quran.id, start: at(-1, 15), minutes: 60, studentIds: [student.id], status: "CANCELLED" });
    // Future sessions: seeded WITHOUT reminder jobs (no automatic WhatsApp from the seed).
    await createSession({ teacherId: teacher.id, subjectId: quran.id, start: at(2), minutes: 60, studentIds: [student.id] });
    await createSession({ teacherId: langTeacher.id, subjectId: english.id, start: at(3, 20), minutes: 90, studentIds: [student3.id, adult.id] });
    await createSession({ teacherId: teacher.id, subjectId: quran.id, start: at(4), minutes: 60, studentIds: [student.id], replacementForSessionId: s6.id });

    // ---- Evaluations, monthly report -----------------------------------------------
    await prisma.sessionEvaluation.create({ data: { academyId, sessionId: s1.id, authorUserId: studentUser.id, studentId: student.id, authorType: "STUDENT", rating: 5, comment: "Very helpful session." } });
    await prisma.sessionEvaluation.create({ data: { academyId, sessionId: s1.id, authorUserId: guardianUser.id, studentId: student.id, authorType: "GUARDIAN", rating: 4 } });
    await prisma.sessionEvaluation.create({ data: { academyId, sessionId: s4.id, authorUserId: student3User.id, studentId: student3.id, authorType: "STUDENT", rating: 4 } });
    // Current month: the pair must have a non-cancelled session in the report's month
    // (eligibleMonthlyStudents). S1/S2 are 10 and 7 days ago, so this holds unless the
    // seed runs in the first days of a month (owner, 2026-10-26: no September sessions).
    await prisma.monthlyReport.create({
      data: {
        academyId,
        teacherId: teacher.id,
        studentId: student.id,
        monthKey: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
        achievement: "تقدم ملحوظ في الحفظ والتجويد خلال الشهر.",
        learningProgress: "VERY_GOOD",
        classFocus: "OFTEN",
        homeworkCompletion: "MOST_OF_THE_TIME",
        punctuality: "ALWAYS",
        nextMonthObjectives: "إتمام حفظ سورة الملك.",
      },
    });

    // ---- Notification history (no PENDING rows) -------------------------------------
    const job = (data: Omit<Prisma.NotificationJobUncheckedCreateInput, "academyId">) =>
      prisma.notificationJob.create({ data: { academyId, ...data } });
    await job({ recipientUserId: guardianUser.id, reportId: r2.id, kind: "REPORT_SUBMITTED", dedupKey: `REPORT_SUBMITTED:${r2.id}:${guardianUser.id}`, scheduledFor: at(-7, 19), status: "SENT", attempts: 1, sentAt: at(-7, 19) });
    await job({ recipientUserId: studentUser.id, reportId: r1.id, kind: "REPORT_SUBMITTED", dedupKey: `REPORT_SUBMITTED:${r1.id}:${studentUser.id}`, scheduledFor: at(-10, 19), status: "FAILED", attempts: 1, lastError: "Recipient has no phone number." });
    await job({ recipientUserId: quranTeacherUser.id, kind: "REPORT_REJECTED", dedupKey: `REPORT_REJECTED:${r3.id}:seed`, scheduledFor: at(-5, 21), status: "SENT", attempts: 1, sentAt: at(-5, 21) });
    await job({ recipientUserId: guardian2User.id, sessionId: s4.id, kind: "SESSION_REMINDER", dedupKey: `SESSION_REMINDER:${s4.id}:${guardian2User.id}`, scheduledFor: at(-3, 18), status: "FAILED", attempts: 3, lastError: "OpenWA request failed (TypeError)." });
    await job({ recipientUserId: teacherUser.id, sessionId: s6.id, kind: "SESSION_REMINDER", dedupKey: `SESSION_REMINDER:${s6.id}:${teacherUser.id}`, scheduledFor: at(-1, 13), status: "CANCELLED" });

    // ---- Applications (fake contacts) --------------------------------------------------
    const applicantGuardianPhone = fakePhone();
    const applicantTeacherPhone = fakePhone();
    await prisma.application.create({
      data: { academyId, applicationType: "GUARDIAN", contactPhone: applicantGuardianPhone, details: { full_name: "Demo Applicant Guardian", phone_whatsapp: applicantGuardianPhone, timezone: TIMEZONE, preferred_language: "ar", children: [{ name: "Demo Child", age: 9, subjects: ["demo-quran"] }] } },
    });
    await prisma.application.create({
      data: { academyId, applicationType: "TEACHER", contactPhone: applicantTeacherPhone, status: "REVIEWED", reviewedById: admin.id, reviewedAt: at(-1), details: { full_name: "Demo Applicant Teacher", phone_whatsapp: applicantTeacherPhone, timezone: TIMEZONE, preferred_language: "en", subjects: ["demo-english"], years_experience: 4, qualifications: "Demo qualification" } },
    });

    // ---- Counts only (never names, phones or passwords) ------------------------------
    console.log("Demo seed complete.");
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
