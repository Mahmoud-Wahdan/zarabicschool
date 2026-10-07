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
  const deleted = await prisma.teacherSubject.deleteMany({ where: { academyId: user.academyId, ...parsed.data } });
  if (deleted.count === 0) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Assignment not found." } }, { status: 404 });
  return NextResponse.json({ data: { removed: true } });
}
