import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { sessionChangeRequestSchema } from "../../../../../lib/validation/management";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["TEACHER"]);
  if (error) return error;
  const { id: sessionId } = await params;
  const parsed = sessionChangeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid change request.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  const teacher = await prisma.teacher.findFirst({ where: { academyId: user.academyId, userId: user.id }, select: { id: true } });
  if (!teacher) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Teacher profile not found." } }, { status: 403 });
  const session = await prisma.session.findFirst({ where: { id: sessionId, academyId: user.academyId, teacherId: teacher.id }, select: { id: true, status: true } });
  if (!session) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Session not found." } }, { status: 404 });
  if (session.status !== "SCHEDULED") return NextResponse.json({ error: { code: "CONFLICT", message: "Only scheduled sessions can be changed." } }, { status: 409 });
  const requestRecord = await prisma.sessionChangeRequest.create({
    data: { academyId: user.academyId, sessionId, teacherId: teacher.id, ...parsed.data },
    select: { id: true, status: true },
  });
  return NextResponse.json({ data: requestRecord }, { status: 201 });
}
