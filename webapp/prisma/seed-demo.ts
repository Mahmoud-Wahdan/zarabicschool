import { config as dotenvConfig } from "dotenv";
import { randomBytes } from "node:crypto";

dotenvConfig({ path: "../.env" });

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";
import { addMonthsUtc } from "../lib/credits/period";
import { reserveCredit } from "../lib/credits/reserve-credit";
import { enqueueSessionJobs } from "../lib/notifications/session-jobs";
import { wallClockToUtc } from "../lib/schedules/recurrence";
import bcrypt from "bcrypt";

const academyName = "Zarabicschool";
const demoTimezone = "Africa/Cairo";

/** Wall-clock instant at `hour:00` on the Cairo calendar date offset by `dayDelta` days. */
function cairoWallClock(dayDelta: number, hour: number): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: demoTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  // Date arithmetic on the CAIRO local calendar (not the UTC date), so "tomorrow"
  // stays correct around Cairo midnight.
  const base = new Date(Date.UTC(get("year"), get("month") - 1, get("day") + dayDelta, hour, 0, 0));
  return wallClockToUtc(base, demoTimezone);
}

const demoSubjects = [
  {
    slug: "demo-quran",
    nameAr: "القرآن الكريم",
    nameEn: "Quran",
    descriptionAr: "تلاوة وتجويد وحفظ بإشراف معلمات متخصصات",
    descriptionEn: "Recitation, tajweed, and memorization with specialized female teachers",
    icon: "book-open",
    sortOrder: 1,
  },
  {
    slug: "demo-arabic",
    nameAr: "اللغة العربية",
    nameEn: "Arabic",
    descriptionAr: "قراءة وكتابة ونحو بأسلوب يناسب مستوى كل طالب",
    descriptionEn: "Reading, writing, and grammar matched to each student's level",
    icon: "languages",
    sortOrder: 2,
  },
  {
    slug: "demo-english",
    nameAr: "اللغة الإنجليزية",
    nameEn: "English",
    descriptionAr: "محادثة وقواعد ومفردات لتتكلم بثقة",
    descriptionEn: "Conversation, grammar, and vocabulary to speak with confidence",
    icon: "message-circle",
    sortOrder: 3,
  },
  {
    slug: "demo-fiqh",
    nameAr: "الفقه",
    nameEn: "Fiqh",
    descriptionAr: "تعلّم أحكام العبادات والمعاملات بأسلوب مبسّط",
    descriptionEn: "Rulings of worship and transactions, explained simply",
    icon: "scale",
    sortOrder: 4,
  },
  {
    slug: "demo-math",
    nameAr: "الرياضيات",
    nameEn: "Math",
    descriptionAr: "شرح مبسّط وتدريب مستمر يبني الفهم قبل الحفظ",
    descriptionEn: "Clear explanation and ongoing practice that builds understanding before memorization",
    icon: "calculator",
    sortOrder: 5,
  },
];

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the demo seed.`);
  }

  return value;
}

async function main() {
  const directUrl = required("DIRECT_URL");
  const pool = new Pool({ connectionString: directUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const academy = await prisma.academy.upsert({
      where: { name: academyName },
      update: {},
      create: { name: academyName },
    });

    for (const subject of demoSubjects) {
      await prisma.subject.upsert({
        where: {
          academyId_slug: { academyId: academy.id, slug: subject.slug },
        },
        update: {
          nameAr: subject.nameAr,
          nameEn: subject.nameEn,
          descriptionAr: subject.descriptionAr,
          descriptionEn: subject.descriptionEn,
          icon: subject.icon,
          sortOrder: subject.sortOrder,
          isActive: true,
        },
        create: {
          academyId: academy.id,
          ...subject,
          isActive: true,
        },
      });
    }

    const demoPassword = process.env.DEMO_PASSWORD ?? randomBytes(18).toString("base64url");
    const passwordHash = await bcrypt.hash(demoPassword, 12);

    const admin = await prisma.user.findFirstOrThrow({
      where: { academyId: academy.id, role: "ADMIN" },
      select: { id: true },
    });
    const guardianUser = await prisma.user.upsert({
      where: { academyId_username: { academyId: academy.id, username: "demo_guardian" } },
      update: { displayName: "Demo Guardian", passwordHash, isActive: true, mustChangePassword: false },
      create: {
        academyId: academy.id,
        username: "demo_guardian",
        displayName: "Demo Guardian",
        passwordHash,
        role: "GUARDIAN",
        mustChangePassword: false,
      },
    });
    const teacherUser = await prisma.user.upsert({
      where: { academyId_username: { academyId: academy.id, username: "demo_teacher" } },
      update: { displayName: "Demo Teacher", passwordHash, isActive: true, mustChangePassword: false },
      create: {
        academyId: academy.id,
        username: "demo_teacher",
        displayName: "Demo Teacher",
        passwordHash,
        role: "TEACHER",
        mustChangePassword: false,
      },
    });
    const studentUser = await prisma.user.upsert({
      where: { academyId_username: { academyId: academy.id, username: "demo_student" } },
      update: { displayName: "Demo Student", passwordHash, isActive: true, mustChangePassword: false },
      create: {
        academyId: academy.id,
        username: "demo_student",
        displayName: "Demo Student",
        passwordHash,
        role: "STUDENT",
        mustChangePassword: false,
      },
    });
    await prisma.user.upsert({
      where: { academyId_username: { academyId: academy.id, username: "demo_supervisor" } },
      update: { displayName: "Demo Supervisor", passwordHash, isActive: true, mustChangePassword: false },
      create: {
        academyId: academy.id,
        username: "demo_supervisor",
        displayName: "Demo Supervisor",
        passwordHash,
        role: "SUPERVISOR",
        mustChangePassword: false,
      },
    });
    const guardian = await prisma.guardian.upsert({
      where: { userId: guardianUser.id },
      update: { academyId: academy.id, relationship: "MOTHER" },
      create: { userId: guardianUser.id, academyId: academy.id, relationship: "MOTHER" },
    });
    const student = await prisma.student.upsert({
      where: { userId: studentUser.id },
      update: { academyId: academy.id, guardianId: guardian.id, isAdult: false },
      create: {
        userId: studentUser.id,
        academyId: academy.id,
        guardianId: guardian.id,
        isAdult: false,
        enrollmentDate: new Date(),
      },
    });
    const teacher = await prisma.teacher.upsert({
      where: { userId: teacherUser.id },
      update: { academyId: academy.id },
      create: { userId: teacherUser.id, academyId: academy.id },
    });
    const quran = await prisma.subject.findUniqueOrThrow({
      where: { academyId_slug: { academyId: academy.id, slug: "demo-quran" } },
    });
    await prisma.teacherSubject.upsert({
      where: { teacherId_subjectId: { teacherId: teacher.id, subjectId: quran.id } },
      update: { academyId: academy.id },
      create: { academyId: academy.id, teacherId: teacher.id, subjectId: quran.id },
    });
    const periodStartsAt = new Date();
    const periodEndsAt = addMonthsUtc(periodStartsAt, 1);
    const subscription = await prisma.subscription.upsert({
      where: { id: "00000000-0000-0000-0000-000000000601" },
      update: {
        academyId: academy.id,
        studentId: student.id,
        packageType: "MONTHLY_PLAN",
        sessionsPurchased: 8,
        totalAmountMinor: BigInt(80000),
        currency: "EGP",
        periodStartsAt,
        periodEndsAt,
        status: "ACTIVE",
      },
      create: {
        id: "00000000-0000-0000-0000-000000000601",
        academyId: academy.id,
        studentId: student.id,
        packageType: "MONTHLY_PLAN",
        sessionsPurchased: 8,
        totalAmountMinor: BigInt(80000),
        currency: "EGP",
        periodStartsAt,
        periodEndsAt,
        status: "ACTIVE",
      },
    });
    await prisma.$transaction(
      [
        prisma.$executeRawUnsafe("ALTER TABLE subscription_ledger DISABLE TRIGGER subscription_ledger_append_only"),
        prisma.subscriptionLedger.deleteMany({ where: { subscriptionId: subscription.id } }),
        prisma.$executeRawUnsafe("ALTER TABLE subscription_ledger ENABLE TRIGGER subscription_ledger_append_only"),
      ],
      { timeout: 30_000, maxWait: 15_000 }
    );
    await prisma.subscriptionLedger.create({
      data: {
        academyId: academy.id,
        subscriptionId: subscription.id,
        entryType: "INITIAL_PURCHASE",
        sessionsDelta: 8,
      },
    });
    const invoice = await prisma.invoice.upsert({
      where: { id: "00000000-0000-0000-0000-000000000602" },
      update: {
        academyId: academy.id,
        studentId: student.id,
        amountMinor: BigInt(80000),
        currency: "EGP",
        provider: "PAYMOB",
        packageType: "MONTHLY_PLAN",
        sessionsPurchased: 8,
        status: "PENDING",
        subscriptionId: null,
      },
      create: {
        id: "00000000-0000-0000-0000-000000000602",
        academyId: academy.id,
        studentId: student.id,
        amountMinor: BigInt(80000),
        currency: "EGP",
        provider: "PAYMOB",
        packageType: "MONTHLY_PLAN",
        sessionsPurchased: 8,
        status: "PENDING",
      },
    });
    await prisma.paymentAttempt.deleteMany({ where: { invoiceId: invoice.id } });
    await prisma.paymentAttempt.create({
      data: {
        invoiceId: invoice.id,
        provider: "PAYMOB",
        idempotencyKey: "demo-invoice-checkout-attempt",
        status: "CREATED",
      },
    });
    const application = await prisma.application.upsert({
      where: { id: "00000000-0000-0000-0000-000000000605" },
      update: {
        academyId: academy.id,
        applicationType: "STUDENT",
        contactPhone: "+201000000605",
        contactEmail: "demo.student@example.test",
        details: {
          full_name: "Demo Applicant",
          phone_whatsapp: "+201000000605",
          date_of_birth: "2012-01-01",
          subjects: ["demo-quran"],
          level: "beginner",
        },
        status: "NEW",
        reviewedById: null,
        reviewedAt: null,
        approvedById: null,
        approvedAt: null,
        approvedUserId: null,
        rejectionReason: null,
      },
      create: {
        id: "00000000-0000-0000-0000-000000000605",
        academyId: academy.id,
        applicationType: "STUDENT",
        contactPhone: "+201000000605",
        contactEmail: "demo.student@example.test",
        details: {
          full_name: "Demo Applicant",
          phone_whatsapp: "+201000000605",
          date_of_birth: "2012-01-01",
          subjects: ["demo-quran"],
          level: "beginner",
        },
        status: "NEW",
      },
    });
    await prisma.applicationRecord.deleteMany({ where: { applicationId: application.id } });
    const sessionStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    sessionStart.setUTCHours(16, 0, 0, 0);
    const sessionEnd = new Date(sessionStart.getTime() + 60 * 60 * 1000);
    const session = await prisma.session.upsert({
      where: { id: "00000000-0000-0000-0000-000000000603" },
      update: {
        academyId: academy.id,
        teacherId: teacher.id,
        subjectId: quran.id,
        sessionType: "PRIVATE",
        scheduledStart: sessionStart,
        scheduledEnd: sessionEnd,
        durationMinutes: 60,
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/7000000603",
        createdById: admin.id,
        status: "SCHEDULED",
      },
      create: {
        id: "00000000-0000-0000-0000-000000000603",
        academyId: academy.id,
        teacherId: teacher.id,
        subjectId: quran.id,
        sessionType: "PRIVATE",
        scheduledStart: sessionStart,
        scheduledEnd: sessionEnd,
        durationMinutes: 60,
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/7000000603",
        createdById: admin.id,
        status: "SCHEDULED",
      },
    });
    await prisma.sessionStudent.upsert({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
      update: { attendanceStatus: "PENDING", overriddenById: null, overrideReason: null },
      create: { sessionId: session.id, studentId: student.id, attendanceStatus: "PENDING" },
    });
    await prisma.sessionReservation.upsert({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
      update: { status: "RESERVED", releasedAt: null, subscriptionId: subscription.id },
      create: {
        academyId: academy.id,
        sessionId: session.id,
        studentId: student.id,
        subscriptionId: subscription.id,
        status: "RESERVED",
      },
    });
    for (const recipientUserId of [teacherUser.id, studentUser.id, guardianUser.id]) {
      await prisma.notificationJob.upsert({
        where: { dedupKey: `SESSION_REMINDER:${session.id}:${recipientUserId}` },
        update: {
          academyId: academy.id,
          sessionId: session.id,
          scheduledFor: new Date(sessionStart.getTime() - 2 * 60 * 60 * 1000),
          status: "PENDING",
          sentAt: null,
          lastError: null,
        },
        create: {
          academyId: academy.id,
          sessionId: session.id,
          recipientUserId,
          kind: "SESSION_REMINDER",
          dedupKey: `SESSION_REMINDER:${session.id}:${recipientUserId}`,
          scheduledFor: new Date(sessionStart.getTime() - 2 * 60 * 60 * 1000),
        },
      });
      await prisma.notificationJob.upsert({
        where: { dedupKey: `SESSION_START:${session.id}:${recipientUserId}` },
        update: {
          academyId: academy.id,
          sessionId: session.id,
          scheduledFor: sessionStart,
          status: "PENDING",
          sentAt: null,
          lastError: null,
        },
        create: {
          academyId: academy.id,
          sessionId: session.id,
          recipientUserId,
          kind: "SESSION_START",
          dedupKey: `SESSION_START:${session.id}:${recipientUserId}`,
          scheduledFor: sessionStart,
        },
      });
    }
    await prisma.sessionJoinClick.upsert({
      where: { id: "00000000-0000-0000-0000-000000000604" },
      update: { sessionId: session.id, userId: studentUser.id },
      create: {
        id: "00000000-0000-0000-0000-000000000604",
        sessionId: session.id,
        userId: studentUser.id,
      },
    });

    // ---------------------------------------------------------------------------
    // Batch 3 demo data: scheduling-assignment scenarios (idempotent upserts only).
    // Credit ALWAYS goes through Subscription + INITIAL_PURCHASE ledger rows with
    // periods (lib/credits/period.ts); reservations go through reserveCredit only.
    // ---------------------------------------------------------------------------

    async function ensureTeacher(username: string, displayName: string, subjectSlugs: string[]) {
      const user = await prisma.user.upsert({
        where: { academyId_username: { academyId: academy.id, username } },
        update: { displayName, passwordHash, isActive: true, mustChangePassword: false },
        create: {
          academyId: academy.id,
          username,
          displayName,
          passwordHash,
          role: "TEACHER",
          mustChangePassword: false,
        },
      });
      const profile = await prisma.teacher.upsert({
        where: { userId: user.id },
        update: { academyId: academy.id },
        create: { userId: user.id, academyId: academy.id },
      });
      for (const slug of subjectSlugs) {
        const subject = await prisma.subject.findUniqueOrThrow({
          where: { academyId_slug: { academyId: academy.id, slug } },
          select: { id: true },
        });
        await prisma.teacherSubject.upsert({
          where: { teacherId_subjectId: { teacherId: profile.id, subjectId: subject.id } },
          update: { academyId: academy.id },
          create: { academyId: academy.id, teacherId: profile.id, subjectId: subject.id },
        });
      }
      return profile;
    }

    async function ensureStudent(
      username: string,
      displayName: string,
      options: { withGuardian?: boolean; subjectSlug?: string } = {}
    ) {
      const user = await prisma.user.upsert({
        where: { academyId_username: { academyId: academy.id, username } },
        update: { displayName, passwordHash, isActive: true, mustChangePassword: false },
        create: {
          academyId: academy.id,
          username,
          displayName,
          passwordHash,
          role: "STUDENT",
          mustChangePassword: false,
        },
      });
      const profile = await prisma.student.upsert({
        where: { userId: user.id },
        update: { academyId: academy.id, guardianId: options.withGuardian ? guardian.id : null },
        create: {
          userId: user.id,
          academyId: academy.id,
          guardianId: options.withGuardian ? guardian.id : null,
          isAdult: false,
          enrollmentDate: new Date(),
        },
      });
      if (options.subjectSlug) {
        const subject = await prisma.subject.findUniqueOrThrow({
          where: { academyId_slug: { academyId: academy.id, slug: options.subjectSlug } },
          select: { id: true },
        });
        await prisma.studentSubject.upsert({
          where: { studentId_subjectId: { studentId: profile.id, subjectId: subject.id } },
          update: { academyId: academy.id },
          create: { academyId: academy.id, studentId: profile.id, subjectId: subject.id },
        });
      }
      return profile;
    }

    async function ensureSubscription(
      id: string,
      studentId: string,
      sessionsDelta: number,
      packageType: "MONTHLY_PLAN" | "PAY_PER_SESSION" = "MONTHLY_PLAN"
    ) {
      const periodStartsAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const periodEndsAt = packageType === "MONTHLY_PLAN" ? addMonthsUtc(periodStartsAt, 1) : null;
      const subscription = await prisma.subscription.upsert({
        where: { id },
        update: {
          academyId: academy.id,
          studentId,
          packageType,
          sessionsPurchased: Math.max(sessionsDelta, 0),
          totalAmountMinor: BigInt(Math.max(sessionsDelta, 0) * 10000),
          currency: "EGP",
          periodStartsAt,
          periodEndsAt,
          status: "ACTIVE",
        },
        create: {
          id,
          academyId: academy.id,
          studentId,
          packageType,
          sessionsPurchased: Math.max(sessionsDelta, 0),
          totalAmountMinor: BigInt(Math.max(sessionsDelta, 0) * 10000),
          currency: "EGP",
          periodStartsAt,
          periodEndsAt,
          status: "ACTIVE",
        },
      });
      await prisma.$transaction(
        [
          prisma.$executeRawUnsafe("ALTER TABLE subscription_ledger DISABLE TRIGGER subscription_ledger_append_only"),
          prisma.subscriptionLedger.deleteMany({ where: { subscriptionId: subscription.id } }),
          prisma.$executeRawUnsafe("ALTER TABLE subscription_ledger ENABLE TRIGGER subscription_ledger_append_only"),
        ],
        { timeout: 30_000, maxWait: 15_000 }
      );
      if (sessionsDelta !== 0) {
        await prisma.subscriptionLedger.create({
          data: {
            academyId: academy.id,
            subscriptionId: subscription.id,
            entryType: "INITIAL_PURCHASE",
            sessionsDelta,
          },
        });
      }
      return subscription;
    }

    async function ensureActiveAssignment(
      studentId: string,
      teacherId: string,
      subjectId: string
    ) {
      const existing = await prisma.studentTeacherAssignment.findFirst({
        where: { academyId: academy.id, studentId, teacherId, subjectId, status: "ACTIVE" },
        select: { id: true },
      });
      if (existing) return existing.id;
      const conflicting = await prisma.studentTeacherAssignment.findFirst({
        where: { academyId: academy.id, studentId, subjectId, status: "ACTIVE" },
        select: { id: true, teacherId: true },
      });
      if (conflicting) {
        // Realign to the documented scenario: end the drifted assignment (change-teacher
        // flow) and create the canonical one, so the seeded cases stay deterministic.
        await prisma.studentTeacherAssignment.update({
          where: { id: conflicting.id },
          data: {
            status: "ENDED",
            endedAt: new Date(),
            endedReason: "Demo seed: realigned to the documented scenario teacher",
          },
        });
        console.log(`  (realigned assignment: previous ACTIVE teacher replaced by the scenario teacher)`);
      }
      const created = await prisma.studentTeacherAssignment.create({
        data: {
          academyId: academy.id,
          studentId,
          teacherId,
          subjectId,
          status: "ACTIVE",
          createdById: admin.id,
        },
        select: { id: true },
      });
      return created.id;
    }

    async function ensureReservation(
      sessionId: string,
      studentId: string,
      subscriptionId: string,
      sessionDate: Date,
      options: { released?: boolean } = {}
    ) {
      const existing = await prisma.sessionReservation.findUnique({
        where: { sessionId_studentId: { sessionId, studentId } },
        select: { id: true, status: true },
      });
      if (existing && existing.status === "RESERVED" && !options.released) return;
      if (existing && existing.status === "RELEASED" && options.released) return;
      await prisma.$transaction(
        async (tx) => {
          const ok = await reserveCredit(tx, academy.id, studentId, sessionId, sessionDate);
          if (!ok) throw new Error(`Seed reservation failed (no credit) for student ${studentId} in session ${sessionId}`);
          if (options.released) {
            await tx.sessionReservation.updateMany({
              where: { sessionId, studentId, status: "RESERVED" },
              data: { status: "RELEASED", releasedAt: new Date() },
            });
          }
        },
        { timeout: 30_000, maxWait: 15_000 }
      );
      void subscriptionId;
    }

    const teacherQuran = await ensureTeacher("demo_teacher_quran", "Demo Quran Teacher", ["demo-quran"]);
    const teacherLang = await ensureTeacher("demo_teacher_lang", "Demo Language Teacher", ["demo-english", "demo-arabic"]);
    const teacherMulti = await ensureTeacher("demo_teacher_multi", "Demo Multi-Subject Teacher", ["demo-quran", "demo-english"]);
    void teacherLang;

    const studentCreditMany = await ensureStudent("demo_student_credit_many", "Demo Student Credit Many", { withGuardian: true, subjectSlug: "demo-quran" });
    const studentCreditOne = await ensureStudent("demo_student_credit_one", "Demo Student Credit One", { subjectSlug: "demo-quran" });
    const studentZero = await ensureStudent("demo_student_zero", "Demo Student Zero Credit", { subjectSlug: "demo-quran" });
    const studentNosub = await ensureStudent("demo_student_nosub", "Demo Student No Subscription", { subjectSlug: "demo-quran" });
    const studentUnassigned = await ensureStudent("demo_student_unassigned", "Demo Student Unassigned", { subjectSlug: "demo-quran" });
    const studentGroupA = await ensureStudent("demo_student_group_a", "Demo Student Group A", { withGuardian: true, subjectSlug: "demo-quran" });
    const studentGroupB = await ensureStudent("demo_student_group_b", "Demo Student Group B", { withGuardian: true, subjectSlug: "demo-quran" });

    // Bookkeeping for the original demo student as well (Step-0 decision).
    await prisma.studentSubject.upsert({
      where: { studentId_subjectId: { studentId: student.id, subjectId: quran.id } },
      update: { academyId: academy.id },
      create: { academyId: academy.id, studentId: student.id, subjectId: quran.id },
    });
    await ensureActiveAssignment(student.id, teacher.id, quran.id);

    const subCreditMany = await ensureSubscription("00000000-0000-0000-0000-000000000609", studentCreditMany.id, 8);
    await ensureSubscription("00000000-0000-0000-0000-00000000060a", studentCreditOne.id, 1);
    await ensureSubscription("00000000-0000-0000-0000-00000000060b", studentZero.id, 0);
    const subGroupA = await ensureSubscription("00000000-0000-0000-0000-00000000060c", studentGroupA.id, 4);
    const subGroupB = await ensureSubscription("00000000-0000-0000-0000-00000000060d", studentGroupB.id, 4);
    void subCreditMany;
    void subGroupA;
    void subGroupB;

    await ensureActiveAssignment(studentCreditMany.id, teacherQuran.id, quran.id);
    await ensureActiveAssignment(studentCreditOne.id, teacherQuran.id, quran.id);
    await ensureActiveAssignment(studentZero.id, teacherQuran.id, quran.id);
    await ensureActiveAssignment(studentNosub.id, teacherQuran.id, quran.id);
    await ensureActiveAssignment(studentGroupA.id, teacherQuran.id, quran.id);
    await ensureActiveAssignment(studentGroupB.id, teacherQuran.id, quran.id);
    // One ENDED assignment: unassigned switched from the multi-subject teacher (history row).
    {
      const existingEnded = await prisma.studentTeacherAssignment.findFirst({
        where: { academyId: academy.id, studentId: studentUnassigned.id, teacherId: teacherMulti.id, subjectId: quran.id, status: "ENDED" },
        select: { id: true },
      });
      if (!existingEnded) {
        await prisma.studentTeacherAssignment.create({
          data: {
            academyId: academy.id,
            studentId: studentUnassigned.id,
            teacherId: teacherMulti.id,
            subjectId: quran.id,
            status: "ENDED",
            createdById: admin.id,
            endedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
            endedReason: "Demo: teacher changed, not yet replaced",
          },
          select: { id: true },
        });
      }
    }

    // Day offsets are computed on the Cairo local calendar (see cairoWallClock), so
    // "tomorrow/yesterday 18:00 Cairo" is correct even when Cairo's date differs from the UTC date.
    const tomorrow18 = cairoWallClock(1, 18);
    const yesterday18 = cairoWallClock(-1, 18);
    const yesterday16 = cairoWallClock(-1, 16);

    // Future SCHEDULED session for demo_teacher_quran: tomorrow 18:00-19:00 Cairo (E2E conflict anchor).
    const futureSessionId = "00000000-0000-0000-0000-000000000606";
    await prisma.session.upsert({
      where: { id: futureSessionId },
      update: {
        academyId: academy.id,
        teacherId: teacherQuran.id,
        subjectId: quran.id,
        sessionType: "PRIVATE",
        scheduledStart: tomorrow18,
        scheduledEnd: new Date(tomorrow18.getTime() + 60 * 60 * 1000),
        durationMinutes: 60,
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/7001112233",
        createdById: admin.id,
        status: "SCHEDULED",
      },
      create: {
        id: futureSessionId,
        academyId: academy.id,
        teacherId: teacherQuran.id,
        subjectId: quran.id,
        sessionType: "PRIVATE",
        scheduledStart: tomorrow18,
        scheduledEnd: new Date(tomorrow18.getTime() + 60 * 60 * 1000),
        durationMinutes: 60,
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/7001112233",
        createdById: admin.id,
        status: "SCHEDULED",
        students: { create: [{ studentId: studentCreditMany.id }] },
      },
    });
    await prisma.sessionStudent.upsert({
      where: { sessionId_studentId: { sessionId: futureSessionId, studentId: studentCreditMany.id } },
      update: {},
      create: { sessionId: futureSessionId, studentId: studentCreditMany.id, attendanceStatus: "PENDING" },
    });
    await ensureReservation(futureSessionId, studentCreditMany.id, subCreditMany.id, tomorrow18);
    const creditManyUser = await prisma.user.findFirstOrThrow({ where: { username: "demo_student_credit_many" }, select: { id: true } });
    const teacherQuranUser = await prisma.user.findFirstOrThrow({ where: { username: "demo_teacher_quran" }, select: { id: true } });
    await enqueueSessionJobs(prisma, academy.id, futureSessionId, tomorrow18, teacherQuranUser.id, [creditManyUser.id], [guardianUser.id]);

    // CANCELLED session for the same teacher: yesterday 16:00-17:00 Cairo (released reservation).
    const cancelledSessionId = "00000000-0000-0000-0000-000000000607";
    await prisma.session.upsert({
      where: { id: cancelledSessionId },
      update: {
        academyId: academy.id,
        teacherId: teacherQuran.id,
        subjectId: quran.id,
        sessionType: "PRIVATE",
        scheduledStart: yesterday16,
        scheduledEnd: new Date(yesterday16.getTime() + 60 * 60 * 1000),
        durationMinutes: 60,
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/7001112244",
        createdById: admin.id,
        status: "CANCELLED",
        cancellationReason: "Demo cancellation",
        cancelledById: admin.id,
      },
      create: {
        id: cancelledSessionId,
        academyId: academy.id,
        teacherId: teacherQuran.id,
        subjectId: quran.id,
        sessionType: "PRIVATE",
        scheduledStart: yesterday16,
        scheduledEnd: new Date(yesterday16.getTime() + 60 * 60 * 1000),
        durationMinutes: 60,
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/7001112244",
        createdById: admin.id,
        status: "CANCELLED",
        cancellationReason: "Demo cancellation",
        students: { create: [{ studentId: studentCreditMany.id }] },
      },
    });
    await prisma.sessionStudent.upsert({
      where: { sessionId_studentId: { sessionId: cancelledSessionId, studentId: studentCreditMany.id } },
      update: {},
      create: { sessionId: cancelledSessionId, studentId: studentCreditMany.id, attendanceStatus: "PENDING" },
    });
    await ensureReservation(cancelledSessionId, studentCreditMany.id, subCreditMany.id, yesterday16, { released: true });

    // Past SCHEDULED session with no report (Phase 5 material): yesterday 18:00-19:00 Cairo.
    const pastSessionId = "00000000-0000-0000-0000-000000000608";
    await prisma.session.upsert({
      where: { id: pastSessionId },
      update: {
        academyId: academy.id,
        teacherId: teacherQuran.id,
        subjectId: quran.id,
        sessionType: "PRIVATE",
        scheduledStart: yesterday18,
        scheduledEnd: new Date(yesterday18.getTime() + 60 * 60 * 1000),
        durationMinutes: 60,
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/7001112255",
        createdById: admin.id,
        status: "SCHEDULED",
      },
      create: {
        id: pastSessionId,
        academyId: academy.id,
        teacherId: teacherQuran.id,
        subjectId: quran.id,
        sessionType: "PRIVATE",
        scheduledStart: yesterday18,
        scheduledEnd: new Date(yesterday18.getTime() + 60 * 60 * 1000),
        durationMinutes: 60,
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/7001112255",
        createdById: admin.id,
        status: "SCHEDULED",
        students: { create: [{ studentId: studentGroupA.id }] },
      },
    });
    await prisma.sessionStudent.upsert({
      where: { sessionId_studentId: { sessionId: pastSessionId, studentId: studentGroupA.id } },
      update: {},
      create: { sessionId: pastSessionId, studentId: studentGroupA.id, attendanceStatus: "PENDING" },
    });
    await ensureReservation(pastSessionId, studentGroupA.id, subGroupA.id, yesterday18);

    // Final scenario table (username -> role -> available credit -> teacher/subject -> case).
    const demoStudentCases: { username: string; caseName: string }[] = [
      { username: "demo_student", caseName: "base student (has session 603 with demo_teacher)" },
      { username: "demo_student_credit_many", caseName: "8 credits; books freely; conflict-anchor participant" },
      { username: "demo_student_credit_one", caseName: "1 credit; first booking succeeds, second -> INSUFFICIENT_SESSION_CREDIT" },
      { username: "demo_student_zero", caseName: "subscription with zero credit -> INSUFFICIENT_SESSION_CREDIT" },
      { username: "demo_student_nosub", caseName: "StudentSubject only, no subscription -> INSUFFICIENT_SESSION_CREDIT" },
      { username: "demo_student_unassigned", caseName: "StudentSubject, no ACTIVE assignment (ENDED history) -> STUDENT_NOT_ASSIGNED / needs-teacher" },
      { username: "demo_student_group_a", caseName: "group member; has past SCHEDULED session without report (Phase 5)" },
      { username: "demo_student_group_b", caseName: "group member (same teacher+subject as group_a)" },
    ];
    console.log("\nDemo scheduling scenarios:");
    for (const entry of demoStudentCases) {
      const user = await prisma.user.findFirstOrThrow({
        where: { username: entry.username },
        select: { id: true, role: true },
      });
      const studentProfile = await prisma.student.findFirstOrThrow({
        where: { userId: user.id },
        select: { id: true },
      });
      const ledgers = await prisma.subscriptionLedger.findMany({
        where: { subscription: { studentId: studentProfile.id } },
        select: { sessionsDelta: true },
      });
      const reservations = await prisma.sessionReservation.count({
        where: { studentId: studentProfile.id, status: "RESERVED" },
      });
      const balance = ledgers.reduce((total, entry2) => total + entry2.sessionsDelta, 0) - reservations;
      const assignment = await prisma.studentTeacherAssignment.findFirst({
        where: { studentId: studentProfile.id, subjectId: quran.id, status: "ACTIVE" },
        select: { teacher: { select: { user: { select: { displayName: true } } } }, subject: { select: { nameEn: true } } },
      });
      const activeAssignment = assignment
        ? `${assignment.teacher.user.displayName} / ${assignment.subject.nameEn}`
        : await prisma.studentSubject.count({ where: { studentId: studentProfile.id } }).then((count) => (count > 0 ? "— (needs a teacher)" : "— (no subjects)"));
      console.log(`${entry.username.padEnd(26)} | ${user.role.padEnd(7)} | credit: ${String(balance).padStart(3)} | ${activeAssignment.padEnd(34)} | ${entry.caseName}`);
    }
    console.log(`\nTeachers: demo_teacher_quran (Quran), demo_teacher_lang (English+Arabic), demo_teacher_multi (Quran+English)`);
    console.log(`Sessions: ${futureSessionId} SCHEDULED tomorrow 18:00 Cairo; ${cancelledSessionId} CANCELLED yesterday 16:00; ${pastSessionId} SCHEDULED yesterday 18:00 (no report)`);
    console.log(`Seed admin id: ${admin.id}`);
    console.log(`Demo login password (all demo users): ${demoPassword}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
