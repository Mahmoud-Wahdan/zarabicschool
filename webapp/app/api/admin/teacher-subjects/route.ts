import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { teacherSubjectSchema } from "../../../../lib/validation/management";

export async function POST(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = teacherSubjectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Teacher and subject are required." } }, { status: 400 });
  const { teacherId, subjectId } = parsed.data;
  const [teacher, subject] = await Promise.all([
    prisma.teacher.findFirst({ where: { id: teacherId, academyId: user.academyId }, select: { id: true } }),
    prisma.subject.findFirst({ where: { id: subjectId, academyId: user.academyId, isActive: true }, select: { id: true } }),
  ]);
  if (!teacher || !subject) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Teacher or active subject not found." } }, { status: 404 });
  try {
    const assignment = await prisma.teacherSubject.create({ data: { academyId: user.academyId, teacherId, subjectId } });
    return NextResponse.json({ data: assignment }, { status: 201 });
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") return NextResponse.json({ error: { code: "CONFLICT", message: "This teacher is already assigned to the subject." } }, { status: 409 });
    throw cause;
  }
}

export async function DELETE(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = teacherSubjectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Teacher and subject are required." } }, { status: 400 });
  try {
    const deleted = await prisma.teacherSubject.deleteMany({ where: { academyId: user.academyId, ...parsed.data } });
    if (deleted.count === 0) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Assignment not found." } }, { status: 404 });
    return NextResponse.json({ data: { removed: true } });
  } catch (cause) {
    // The composite FK from student_teacher_assignments(teacher_id, subject_id) blocks the
    // removal while ANY assignment history (ACTIVE or ENDED) references the pair.
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2003") {
      return NextResponse.json(
        { error: { code: "TEACHER_SUBJECT_IN_USE", message: "This teacher has student assignments for this subject, so the subject cannot be removed from them. The link stays for the assignment history." } },
        { status: 409 },
      );
    }
    throw cause;
  }
}
