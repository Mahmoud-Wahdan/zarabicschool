import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../../lib/dal";
import { prisma } from "../../../../../../lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const { id } = await params;
  const teacher = await prisma.teacher.findFirst({
    where: { id, academyId: user.academyId },
    select: { id: true, user: { select: { displayName: true, isActive: true } } },
  });
  if (!teacher) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Teacher not found." } }, { status: 404 });

  const url = new URL(request.url);
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const fromDate = fromRaw && !Number.isNaN(new Date(fromRaw).getTime()) ? new Date(fromRaw) : null;
  const toDate = toRaw && !Number.isNaN(new Date(toRaw).getTime()) ? new Date(toRaw) : null;
  if ((fromRaw && !fromDate) || (toRaw && !toDate)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "from and to must be valid dates." } }, { status: 400 });
  }

  const [subjects, busySlots, assignments] = await Promise.all([
    prisma.teacherSubject.findMany({
      where: { teacherId: teacher.id, subject: { isActive: true } },
      select: { subject: { select: { id: true, nameEn: true, nameAr: true } } },
      orderBy: { subject: { sortOrder: "asc" } },
    }),
    prisma.session.findMany({
      where: {
        teacherId: teacher.id,
        academyId: user.academyId,
        status: "SCHEDULED",
        ...(fromDate && toDate
          ? { scheduledStart: { lt: toDate }, scheduledEnd: { gt: fromDate } }
          : { scheduledStart: { gte: new Date() } }),
      },
      orderBy: { scheduledStart: "asc" },
      take: 200,
      select: {
        id: true,
        scheduledStart: true,
        scheduledEnd: true,
        status: true,
        sessionType: true,
        subject: { select: { nameEn: true, nameAr: true } },
      },
    }),
    prisma.studentTeacherAssignment.findMany({
      where: { teacherId: teacher.id, academyId: user.academyId, status: "ACTIVE" },
      select: {
        subjectId: true,
        studentId: true,
        student: { select: { user: { select: { displayName: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const assignedStudents = assignments.reduce<{ subjectId: string; students: { studentId: string; displayName: string }[] }[]>((groups, assignment) => {
    let group = groups.find((item) => item.subjectId === assignment.subjectId);
    if (!group) {
      group = { subjectId: assignment.subjectId, students: [] };
      groups.push(group);
    }
    group.students.push({ studentId: assignment.studentId, displayName: assignment.student.user.displayName });
    return groups;
  }, []);

  return NextResponse.json({
    data: {
      teacher: { id: teacher.id, displayName: teacher.user.displayName, isActive: teacher.user.isActive },
      subjects: subjects.map(({ subject }) => subject),
      busySlots,
      assignedStudents,
    },
  });
}
