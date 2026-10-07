import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { enrollmentSchema } from "../../../../lib/validation/management";

export async function POST(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = enrollmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Session and student are required." } }, { status: 400 });
  const { sessionId, studentId } = parsed.data;
  const valid = await prisma.session.findFirst({
    where: { id: sessionId, academyId: user.academyId },
    select: { id: true, subjectId: true },
  });
  const student = await prisma.student.findFirst({ where: { id: studentId, academyId: user.academyId, user: { isActive: true } }, select: { id: true } });
  if (!valid || !student) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Session or student not found." } }, { status: 404 });
  const assignment = await prisma.teacherSubject.findFirst({ where: { academyId: user.academyId, subjectId: valid.subjectId, teacher: { sessions: { some: { id: sessionId } } } }, select: { id: true } });
  if (!assignment) return NextResponse.json({ error: { code: "CONFLICT", message: "Student enrollment does not match the session subject." } }, { status: 409 });
  try {
    const enrollment = await prisma.sessionStudent.create({ data: { sessionId, studentId } });
    return NextResponse.json({ data: enrollment }, { status: 201 });
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") return NextResponse.json({ error: { code: "CONFLICT", message: "Student is already enrolled in this session." } }, { status: 409 });
    throw cause;
  }
}

export async function DELETE(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = enrollmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Session and student are required." } }, { status: 400 });
  const session = await prisma.session.findFirst({ where: { id: parsed.data.sessionId, academyId: user.academyId }, select: { id: true } });
  if (!session) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Session not found." } }, { status: 404 });
  const deleted = await prisma.sessionStudent.deleteMany({ where: parsed.data });
  if (!deleted.count) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Enrollment not found." } }, { status: 404 });
  return NextResponse.json({ data: { removed: true } });
}
