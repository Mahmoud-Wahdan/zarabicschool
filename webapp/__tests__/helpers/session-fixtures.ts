import { randomUUID } from "node:crypto";

import bcrypt from "bcrypt";

import { disconnectPrisma, prisma } from "../../lib/prisma";

export type SessionFixtures = Awaited<ReturnType<typeof createSessionFixtures>>;

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

export async function cleanupSessionFixtures(fixtures: SessionFixtures) {
  for (const academyId of [fixtures.academyId, fixtures.foreignAcademyId]) {
    const invoices = await prisma.invoice.findMany({ where: { academyId }, select: { id: true } });
    await prisma.paymentAttempt.deleteMany({ where: { invoiceId: { in: invoices.map((invoice) => invoice.id) } } });
    await prisma.$transaction([
      prisma.$executeRawUnsafe("ALTER TABLE subscription_ledger DISABLE TRIGGER subscription_ledger_append_only"),
      prisma.subscriptionLedger.deleteMany({ where: { academyId } }),
      prisma.$executeRawUnsafe("ALTER TABLE subscription_ledger ENABLE TRIGGER subscription_ledger_append_only"),
    ]);
    await prisma.invoice.deleteMany({ where: { academyId } });
    await prisma.sessionJoinClick.deleteMany({ where: { session: { academyId } } });
    await prisma.notificationJob.deleteMany({ where: { academyId } });
    await prisma.sessionReservation.deleteMany({ where: { academyId } });
    await prisma.sessionChangeRequest.deleteMany({ where: { academyId } });
    await prisma.teacherFlag.deleteMany({ where: { academyId } });
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
