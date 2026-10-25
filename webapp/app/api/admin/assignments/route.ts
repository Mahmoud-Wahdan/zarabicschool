import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { runSerializable } from "../../../../lib/credits/reservation";
import { assignmentCreateSchema, assignmentListSchema } from "../../../../lib/validation/management";

export async function GET(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const url = new URL(request.url);
  const parsed = assignmentListSchema.safeParse({
    studentId: url.searchParams.get("studentId") ?? undefined,
    teacherId: url.searchParams.get("teacherId") ?? undefined,
    subjectId: url.searchParams.get("subjectId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid assignment filters." } }, { status: 400 });
  }
  const filters = parsed.data;
  const assignments = await prisma.studentTeacherAssignment.findMany({
    where: {
      academyId: user.academyId,
      ...(filters.studentId ? { studentId: filters.studentId } : {}),
      ...(filters.teacherId ? { teacherId: filters.teacherId } : {}),
      ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      createdAt: true,
      endedAt: true,
      endedReason: true,
      studentId: true,
      teacherId: true,
      subjectId: true,
      student: { select: { user: { select: { displayName: true } } } },
      teacher: { select: { user: { select: { displayName: true } } } },
      subject: { select: { nameEn: true, nameAr: true } },
      createdBy: { select: { displayName: true } },
    },
  });
  return NextResponse.json({ data: assignments });
}

export async function POST(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = assignmentCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Student, teacher, and subject are required." } }, { status: 400 });
  }
  const data = parsed.data;
  try {
    const assignment = await runSerializable(async (tx) => {
      const [student, teacher, subject] = await Promise.all([
        tx.student.findFirst({ where: { id: data.studentId, academyId: user.academyId, user: { isActive: true } }, select: { id: true } }),
        tx.teacher.findFirst({ where: { id: data.teacherId, academyId: user.academyId, user: { isActive: true } }, select: { id: true } }),
        tx.subject.findFirst({ where: { id: data.subjectId, academyId: user.academyId, isActive: true }, select: { id: true } }),
      ]);
      if (!student || !teacher || !subject) {
        throw new Error("ASSIGNMENT_PARTICIPANTS_INVALID");
      }
      const teacherSubject = await tx.teacherSubject.findFirst({
        where: { academyId: user.academyId, teacherId: data.teacherId, subjectId: data.subjectId },
        select: { id: true },
      });
      if (!teacherSubject) {
        throw new Error("TEACHER_SUBJECT_NOT_ASSIGNED");
      }
      const activeAssignment = await tx.studentTeacherAssignment.findFirst({
        where: { academyId: user.academyId, studentId: data.studentId, subjectId: data.subjectId, status: "ACTIVE" },
        select: { id: true },
      });
      if (activeAssignment) {
        throw new Error("DUPLICATE_ASSIGNMENT");
      }
      return tx.studentTeacherAssignment.create({
        data: {
          academyId: user.academyId,
          studentId: data.studentId,
          teacherId: data.teacherId,
          subjectId: data.subjectId,
          status: "ACTIVE",
          createdById: user.id,
        },
        select: { id: true, status: true, createdAt: true },
      });
    });
    return NextResponse.json({ data: assignment }, { status: 201 });
  } catch (cause) {
    if (cause instanceof Error) {
      if (cause.message === "ASSIGNMENT_PARTICIPANTS_INVALID") {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "Student, teacher, or subject was not found in this academy." } }, { status: 404 });
      }
      if (cause.message === "TEACHER_SUBJECT_NOT_ASSIGNED") {
        return NextResponse.json({ error: { code: "TEACHER_SUBJECT_NOT_ASSIGNED", message: "The selected teacher is not linked to the selected subject. Link the subject to the teacher first." } }, { status: 409 });
      }
      if (cause.message === "DUPLICATE_ASSIGNMENT") {
        return NextResponse.json({ error: { code: "DUPLICATE_ASSIGNMENT", message: "The student already has an active teacher for this subject. End that assignment or use change-teacher." } }, { status: 409 });
      }
      if (typeof cause === "object" && "code" in cause && cause.code === "P2002") {
        return NextResponse.json({ error: { code: "DUPLICATE_ASSIGNMENT", message: "The student already has an active teacher for this subject." } }, { status: 409 });
      }
    }
    throw cause;
  }
}
