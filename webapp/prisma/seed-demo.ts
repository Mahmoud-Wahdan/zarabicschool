import { config as dotenvConfig } from "dotenv";
import { randomBytes } from "node:crypto";

dotenvConfig({ path: "../.env" });

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";
import { addMonthsUtc } from "../lib/credits/period";
import bcrypt from "bcrypt";

const academyName = "Zarabicschool";

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
    await prisma.subscriptionLedger.deleteMany({ where: { subscriptionId: subscription.id } });
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
        zoomJoinUrl: "https://zoom.us/j/demo-session",
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
        zoomJoinUrl: "https://zoom.us/j/demo-session",
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

    console.log(`Seeded ${demoSubjects.length} subjects, demo profiles, subscription, invoice, and session.`);
    console.log(`Demo login password: ${demoPassword}`);
    console.log(`Seed admin id: ${admin.id}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
