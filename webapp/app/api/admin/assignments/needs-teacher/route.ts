import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";

export async function GET() {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const studentSubjects = await prisma.studentSubject.findMany({
    where: { academyId: user.academyId, student: { user: { isActive: true } } },
    select: {
      studentId: true,
      subjectId: true,
      createdAt: true,
      student: { select: { user: { select: { displayName: true } } } },
      subject: { select: { nameEn: true, nameAr: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  const activeAssignments = await prisma.studentTeacherAssignment.findMany({
    where: { academyId: user.academyId, status: "ACTIVE" },
    select: { studentId: true, subjectId: true },
  });
  const covered = new Set(activeAssignments.map((assignment) => `${assignment.studentId}:${assignment.subjectId}`));
  const needsTeacher = studentSubjects.filter((entry) => !covered.has(`${entry.studentId}:${entry.subjectId}`));
  return NextResponse.json({ data: needsTeacher });
}
