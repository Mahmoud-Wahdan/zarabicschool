import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { runSerializable } from "../../../../../lib/credits/reservation";
import { assignmentUpdateSchema } from "../../../../../lib/validation/management";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const { id } = await params;
  const parsed = assignmentUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Provide action END or CHANGE_TEACHER." } }, { status: 400 });
  }
  const data = parsed.data;
  const existing = await prisma.studentTeacherAssignment.findFirst({
    where: { id, academyId: user.academyId },
    select: { id: true, status: true, studentId: true, subjectId: true },
  });
  if (!existing) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Assignment not found." } }, { status: 404 });
  if (existing.status !== "ACTIVE") {
    return NextResponse.json({ error: { code: "CONFLICT", message: "This assignment has already ended." } }, { status: 409 });
  }
  const endedAt = new Date();
  const endedReason = data.endedReason ? data.endedReason : null;
  try {
    const result = await runSerializable(async (tx) => {
      if (data.action === "END") {
        const updated = await tx.studentTeacherAssignment.update({
          where: { id: existing.id },
          data: { status: "ENDED", endedAt, endedReason },
          select: { id: true, status: true, endedAt: true },
        });
        return { ended: updated, created: null };
      }
      const newTeacher = await tx.teacher.findFirst({
        where: { id: data.newTeacherId, academyId: user.academyId, user: { isActive: true } },
        select: { id: true },
      });
      if (!newTeacher) throw new Error("ASSIGNMENT_PARTICIPANTS_INVALID");
      const teacherSubject = await tx.teacherSubject.findFirst({
        where: { academyId: user.academyId, teacherId: data.newTeacherId, subjectId: existing.subjectId },
        select: { id: true },
      });
      if (!teacherSubject) throw new Error("TEACHER_SUBJECT_NOT_ASSIGNED");
      const updated = await tx.studentTeacherAssignment.update({
        where: { id: existing.id },
        data: { status: "ENDED", endedAt, endedReason },
        select: { id: true, status: true, endedAt: true },
      });
      const created = await tx.studentTeacherAssignment.create({
        data: {
          academyId: user.academyId,
          studentId: existing.studentId,
          teacherId: data.newTeacherId,
          subjectId: existing.subjectId,
          status: "ACTIVE",
          createdById: user.id,
        },
        select: { id: true, status: true, teacherId: true },
      });
      return { ended: updated, created };
    });
    return NextResponse.json({ data: result });
  } catch (cause) {
    if (cause instanceof Error) {
      if (cause.message === "ASSIGNMENT_PARTICIPANTS_INVALID") {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "The new teacher was not found in this academy." } }, { status: 404 });
      }
      if (cause.message === "TEACHER_SUBJECT_NOT_ASSIGNED") {
        return NextResponse.json({ error: { code: "TEACHER_SUBJECT_NOT_ASSIGNED", message: "The new teacher is not linked to this subject. Link the subject to the teacher first." } }, { status: 409 });
      }
    }
    throw cause;
  }
}
