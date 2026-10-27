import { randomUUID } from "node:crypto";

import bcrypt from "bcrypt";

import { disconnectPrisma, prisma } from "../../lib/prisma";
import { isLinkAuditReady } from "../../lib/scheduling/link-audit";
import { isAttachmentsReady } from "../../lib/storage/attachment-ready";
import { isSessionRequestsReady } from "../../lib/scheduling/session-requests";

export type SessionFixtures = Awaited<ReturnType<typeof createSessionFixtures>>;

/** Phase 6 payroll tables gate (same pattern as the other capability gates). */
async function isPayrollReady(): Promise<boolean> {
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payroll_ledger'",
  )) as { count: number }[];
  return rows[0]?.count === 1;
}

/** S-1 attendance_resolutions gate (owner-applied migration 20261027120000). */
async function isAttendanceResolutionsReady(): Promise<boolean> {
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'attendance_resolutions'",
  )) as { count: number }[];
  return rows[0]?.count === 1;
}

export async function createSessionFixtures() {
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash("Demo-Test-Pass-1!", 4);

  const academy = await prisma.academy.create({ data: { name: `Zarabicschool Test ${suffix}` } });
  const foreignAcademy = await prisma.academy.create({ data: { name: `Zarabicschool Foreign ${suffix}` } });

  const userSpecs = [
    { key: "admin", role: "ADMIN" as const, academyId: academy.id, phone: "+201000000001" },
    { key: "supervisor", role: "SUPERVISOR" as const, academyId: academy.id, phone: "+201000000002" },
    { key: "teacher", role: "TEACHER" as const, academyId: academy.id, phone: "+201000000003" },
    { key: "teacher2", role: "TEACHER" as const, academyId: academy.id, phone: "+201000000004" },
    { key: "guardian", role: "GUARDIAN" as const, academyId: academy.id, phone: "+201000000005" },
    { key: "student1", role: "STUDENT" as const, academyId: academy.id, phone: "+201000000006" },
    { key: "student2", role: "STUDENT" as const, academyId: academy.id, phone: "+201000000007" },
    { key: "student3", role: "STUDENT" as const, academyId: academy.id, phone: "+201000000008" },
    { key: "student4", role: "STUDENT" as const, academyId: academy.id, phone: "+201000000009" },
    { key: "student5", role: "STUDENT" as const, academyId: academy.id, phone: "+201000000010" },
    { key: "student6", role: "STUDENT" as const, academyId: academy.id, phone: "+201000000011" },
    { key: "student7", role: "STUDENT" as const, academyId: academy.id, phone: "+201000000012" },
    { key: "student8", role: "STUDENT" as const, academyId: academy.id, phone: "+201000000013" },
    { key: "student9", role: "STUDENT" as const, academyId: academy.id, phone: "+201000000017" },
    { key: "student10", role: "STUDENT" as const, academyId: academy.id, phone: "+201000000018" },
    { key: "student11", role: "STUDENT" as const, academyId: academy.id, phone: "+201000000019" },
    { key: "student12", role: "STUDENT" as const, academyId: academy.id, phone: "+201000000020" },
    { key: "foreignAdmin", role: "ADMIN" as const, academyId: foreignAcademy.id, phone: "+201000000014" },
    { key: "foreignTeacher", role: "TEACHER" as const, academyId: foreignAcademy.id, phone: "+201000000015" },
    { key: "foreignStudent", role: "STUDENT" as const, academyId: foreignAcademy.id, phone: "+201000000016" },
  ];

  const users: Record<string, { id: string }> = {};
  for (const spec of userSpecs) {
    const user = await prisma.user.create({
      data: {
        academyId: spec.academyId,
        username: `demo_test_${spec.key}_${suffix}`,
        displayName: `Demo Test ${spec.key}`,
        passwordHash,
        role: spec.role,
        phone: spec.phone,
        timezone: "Africa/Cairo",
        isActive: true,
        mustChangePassword: false,
      },
      select: { id: true },
    });
    users[spec.key] = user;
  }

  const guardian = await prisma.guardian.create({
    data: { userId: users.guardian.id, academyId: academy.id, relationship: "MOTHER" },
    select: { id: true },
  });

  const studentSpecs = [
    "student1", "student2", "student3", "student4",
    "student5", "student6", "student7", "student8",
    "student9", "student10", "student11", "student12",
  ];
  const students: Record<string, string> = {};
  for (const key of studentSpecs) {
    const student = await prisma.student.create({
      data: {
        userId: users[key].id,
        academyId: academy.id,
        guardianId: guardian.id,
        isAdult: false,
        enrollmentDate: new Date(),
      },
      select: { id: true },
    });
    students[key] = student.id;
  }

  const foreignStudent = await prisma.student.create({
    data: { userId: users.foreignStudent.id, academyId: foreignAcademy.id, isAdult: true, enrollmentDate: new Date() },
    select: { id: true },
  });

  const teacher = await prisma.teacher.create({
    data: { userId: users.teacher.id, academyId: academy.id },
    select: { id: true },
  });
  const teacher2 = await prisma.teacher.create({
    data: { userId: users.teacher2.id, academyId: academy.id },
    select: { id: true },
  });
  const foreignTeacher = await prisma.teacher.create({
    data: { userId: users.foreignTeacher.id, academyId: foreignAcademy.id },
    select: { id: true },
  });

  // Phase 6: effective-dated rates so report approval settles instead of failing
  // with NO_TEACHER_RATE. 120 days ago keeps them older than any test-created rate.
  await prisma.teacherRate.createMany({
    data: [
      { profileId: teacher.id, academyId: academy.id, createdById: users.admin.id },
      { profileId: teacher2.id, academyId: academy.id, createdById: users.admin.id },
      { profileId: foreignTeacher.id, academyId: foreignAcademy.id, createdById: users.foreignAdmin.id },
    ].map((entry) => ({
      academyId: entry.academyId,
      teacherId: entry.profileId,
      hourlyRateMinor: 6000,
      currency: "EGP",
      effectiveFrom: new Date(Date.now() - 120 * 24 * 3600 * 1000),
      createdById: entry.createdById,
    })),
  });

  const subject = await prisma.subject.create({
    data: { academyId: academy.id, slug: `demo-test-${suffix}`, nameAr: "قرآن تجريبي", nameEn: "Test Quran", isActive: true },
    select: { id: true },
  });
  const subjectB = await prisma.subject.create({
    data: { academyId: academy.id, slug: `demo-test-b-${suffix}`, nameAr: "لغة تجريبية", nameEn: "Test Arabic", isActive: true },
    select: { id: true },
  });
  const foreignSubject = await prisma.subject.create({
    data: { academyId: foreignAcademy.id, slug: `demo-test-${suffix}`, nameAr: "قرآن أجنبي", nameEn: "Foreign Quran", isActive: true },
    select: { id: true },
  });

  await prisma.teacherSubject.create({ data: { academyId: academy.id, teacherId: teacher.id, subjectId: subject.id } });
  await prisma.teacherSubject.create({ data: { academyId: academy.id, teacherId: teacher2.id, subjectId: subject.id } });
  await prisma.teacherSubject.create({ data: { academyId: foreignAcademy.id, teacherId: foreignTeacher.id, subjectId: foreignSubject.id } });

  // StudentSubject bookkeeping: students 1-10 study the main subject; 11/12 have none.
  const assignedStudentKeys = [
    "student1", "student2", "student3", "student4",
    "student5", "student6", "student7", "student8", "student9", "student10",
  ];
  await prisma.studentSubject.createMany({
    data: assignedStudentKeys.map((key) => ({ academyId: academy.id, studentId: students[key], subjectId: subject.id })),
  });
  await prisma.studentSubject.create({
    data: { academyId: foreignAcademy.id, studentId: foreignStudent.id, subjectId: foreignSubject.id },
  });

  // ACTIVE assignments: students 1-8 -> teacher; student9 -> teacher2. student10 stays unassigned
  // (override/unassigned-path tests); students 11/12 have neither StudentSubject nor assignment.
  await prisma.studentTeacherAssignment.createMany({
    data: [
      ...["student1", "student2", "student3", "student4", "student5", "student6", "student7", "student8"].map((key) => ({
        academyId: academy.id,
        studentId: students[key],
        teacherId: teacher.id,
        subjectId: subject.id,
        createdById: users.admin.id,
      })),
      {
        academyId: academy.id,
        studentId: students.student9,
        teacherId: teacher2.id,
        subjectId: subject.id,
        createdById: users.admin.id,
      },
      {
        academyId: foreignAcademy.id,
        studentId: foreignStudent.id,
        teacherId: foreignTeacher.id,
        subjectId: foreignSubject.id,
        createdById: users.foreignAdmin.id,
      },
    ],
  });

  return {
    suffix,
    academyId: academy.id,
    foreignAcademyId: foreignAcademy.id,
    adminUserId: users.admin.id,
    supervisorUserId: users.supervisor.id,
    teacherUserId: users.teacher.id,
    teacher2UserId: users.teacher2.id,
    guardianUserId: users.guardian.id,
    studentUserIds: Object.fromEntries(studentSpecs.map((key) => [key, users[key].id])),
    foreignAdminUserId: users.foreignAdmin.id,
    foreignTeacherUserId: users.foreignTeacher.id,
    foreignStudentUserId: users.foreignStudent.id,
    teacherProfileId: teacher.id,
    teacher2ProfileId: teacher2.id,
    foreignTeacherProfileId: foreignTeacher.id,
    guardianProfileId: guardian.id,
    studentProfileIds: students,
    foreignStudentProfileId: foreignStudent.id,
    subjectId: subject.id,
    subjectBId: subjectB.id,
    foreignSubjectId: foreignSubject.id,
  };
}

/**
 * Grant credit the way production does (H1–H7 hardening, 2026-10-25): every
 * INITIAL_PURCHASE row needs a positive delta and its OWN PAID invoice (paid_at set,
 * sessions > 0; one INITIAL_PURCHASE per invoice). The invoice belongs to the
 * subscription's student in the same per-run test academy.
 */
export async function writeInitialPurchase(input: { academyId: string; subscriptionId: string; sessionsDelta: number }) {
  const subscription = await prisma.subscription.findUniqueOrThrow({
    where: { id: input.subscriptionId },
    select: { studentId: true, packageType: true },
  });
  const invoice = await prisma.invoice.create({
    data: {
      academyId: input.academyId,
      studentId: subscription.studentId,
      subscriptionId: input.subscriptionId,
      amountMinor: BigInt(100000),
      currency: "EGP",
      provider: "PAYMOB",
      packageType: subscription.packageType,
      sessionsPurchased: input.sessionsDelta,
      status: "PAID",
      paidAt: new Date(),
    },
    select: { id: true },
  });
  return prisma.subscriptionLedger.create({
    data: {
      academyId: input.academyId,
      subscriptionId: input.subscriptionId,
      invoiceId: invoice.id,
      entryType: "INITIAL_PURCHASE",
      sessionsDelta: input.sessionsDelta,
    },
    select: { id: true, invoiceId: true },
  });
}

/**
 * Per-run test academies only (owner, 2026-10-26: tests never touch the demo seed).
 * createSessionFixtures names them "Zarabicschool Test <8 hex>" / "Zarabicschool
 * Foreign <8 hex>"; anything else — above all the seed academy "Zarabicschool" — is
 * refused BEFORE a single row is deleted.
 */
const TEST_ACADEMY_NAME = /^Zarabicschool (Test|Foreign) [0-9a-f]{8}$/;

export async function assertTestAcademy(academyId: string) {
  const academy = await prisma.academy.findUnique({ where: { id: academyId }, select: { name: true } });
  if (!academy) return false;
  if (!TEST_ACADEMY_NAME.test(academy.name)) {
    throw new Error(`Refusing to clean academy ${academyId}: it is not a per-run test academy.`);
  }
  return true;
}

/** Append-only tables: the delete runs with the trigger disabled INSIDE one transaction
 *  scoped to one test academy (the documented exception — never a global disable). */
async function deleteAppendOnly(table: string, trigger: string, academyId: string) {
  // A slow remote DB must not abort cleanup half-way (2026-10-26 run 3: "Unable to
  // start a transaction in the given time" left a test academy behind).
  await prisma.$transaction(
    [
      prisma.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`),
      prisma.$executeRawUnsafe(`DELETE FROM ${table} WHERE academy_id = $1::uuid`, academyId),
      prisma.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`),
    ],
    { maxWait: 30_000, timeout: 60_000 },
  );
}

export async function cleanupSessionFixtures(fixtures: SessionFixtures) {
  // The link-audit table arrives with migration 20261012000000_phase4_link_audit
  // (owner-applied). Cleanup is gated the same way as the audit writes so suites stay
  // green before the migration lands, and audit rows (FK RESTRICT) stop blocking
  // session/series/user deletes once it does.
  const linkAuditReady = await isLinkAuditReady();
  for (const academyId of [fixtures.academyId, fixtures.foreignAcademyId]) {
    if (!(await assertTestAcademy(academyId))) continue;
    // Phase 6–7 tables that reference invoices, sessions or users (they were missing
    // here: a payment_audit row blocked the invoice delete on 2026-10-26).
    await prisma.complaint.deleteMany({ where: { academyId } });
    await prisma.sessionEvaluation.deleteMany({ where: { academyId } });
    await prisma.monthlyReport.deleteMany({ where: { academyId } });
    await prisma.adminMessage.deleteMany({ where: { academyId } });
    await deleteAppendOnly("announcements", "announcements_append_only", academyId);
    await deleteAppendOnly("payment_audit", "payment_audit_append_only", academyId);
    await prisma.paymentProof.deleteMany({ where: { academyId } });
    await prisma.billingSubscription.deleteMany({ where: { academyId } });
    await prisma.billingPlan.deleteMany({ where: { academyId } });
    await prisma.exchangeRate.deleteMany({ where: { academyId } });
    await prisma.applicationRecord.deleteMany({ where: { academyId } });
    await prisma.application.deleteMany({ where: { academyId } });
    const invoices = await prisma.invoice.findMany({ where: { academyId }, select: { id: true } });
    await prisma.paymentAttempt.deleteMany({ where: { invoiceId: { in: invoices.map((invoice) => invoice.id) } } });
    // S-1: append-only resolutions reference subscription_ledger (FK RESTRICT), so
    // they go first, through the same per-academy trigger exception.
    if (await isAttendanceResolutionsReady()) {
      await deleteAppendOnly("attendance_resolutions", "attendance_resolutions_append_only", academyId);
    }
    await deleteAppendOnly("subscription_ledger", "subscription_ledger_append_only", academyId);
    await prisma.invoice.deleteMany({ where: { academyId } });
    if (linkAuditReady) {
      await prisma.sessionLinkAudit.deleteMany({ where: { academyId } });
    }
    await prisma.sessionJoinClick.deleteMany({ where: { session: { academyId } } });
    await prisma.notificationJob.deleteMany({ where: { academyId } });
    await prisma.sessionReservation.deleteMany({ where: { academyId } });
    await prisma.sessionChangeRequest.deleteMany({ where: { academyId } });
    if (await isSessionRequestsReady()) {
      await prisma.sessionRequest.deleteMany({ where: { academyId } });
    }
    await prisma.teacherFlag.deleteMany({ where: { academyId } });
    // payroll_ledger is append-only: cleanup uses the transaction-scoped trigger
    // disable (the documented pattern — never disabled globally) because the
    // RESTRICT FKs would otherwise block session/report/teacher deletes.
    if (await isPayrollReady()) {
      await deleteAppendOnly("payroll_ledger", "payroll_ledger_append_only", academyId);
      await prisma.teacherRate.deleteMany({ where: { academyId } });
    }
    if (await isAttachmentsReady()) {
      await prisma.reportAttachment.deleteMany({ where: { academyId } });
      await prisma.academySetting.deleteMany({ where: { academyId } });
    }
    await prisma.report.deleteMany({ where: { academyId } });
    await prisma.sessionStudent.deleteMany({ where: { session: { academyId } } });
    await prisma.session.deleteMany({ where: { academyId } });
    await prisma.recurrenceSeries.deleteMany({ where: { academyId } });
    await prisma.subscription.deleteMany({ where: { academyId } });
    await prisma.studentTeacherAssignment.deleteMany({ where: { academyId } });
    await prisma.studentSubject.deleteMany({ where: { academyId } });
    await prisma.teacherSubject.deleteMany({ where: { academyId } });
    await prisma.student.deleteMany({ where: { academyId } });
    await prisma.guardian.deleteMany({ where: { academyId } });
    await prisma.teacher.deleteMany({ where: { academyId } });
    await prisma.user.deleteMany({ where: { academyId } });
    await prisma.subject.deleteMany({ where: { academyId } });
    await prisma.academy.deleteMany({ where: { id: academyId } });
  }
}

export async function closePrisma() {
  await disconnectPrisma();
}
