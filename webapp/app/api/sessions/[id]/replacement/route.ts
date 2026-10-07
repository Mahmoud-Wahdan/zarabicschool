import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { reserveCredit } from "../../route";
import { replacementSessionSchema } from "../../../../../lib/validation/management";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const { id: sourceSessionId } = await params;
  const parsed = replacementSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid replacement session details.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  const source = await prisma.session.findFirst({
    where: { id: sourceSessionId, academyId: user.academyId, status: { in: ["MISSED", "CANCELLED"] } },
    select: { id: true },
  });
  if (!source) return NextResponse.json({ error: { code: "CONFLICT", message: "Only missed or cancelled sessions can be replaced." } }, { status: 409 });
  const data = parsed.data;
  const start = new Date(data.scheduledStart);
  const end = new Date(data.scheduledEnd);
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (durationMinutes <= 0 || durationMinutes > 720) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Session duration must be between 1 and 720 minutes." } }, { status: 400 });
  try {
    const replacement = await prisma.$transaction(async (tx) => {
      const teacherSubject = await tx.teacherSubject.findFirst({ where: { academyId: user.academyId, teacherId: data.teacherId, subjectId: data.subjectId } });
      const students = await tx.student.findMany({ where: { id: { in: data.studentIds }, academyId: user.academyId, user: { isActive: true } }, select: { id: true } });
      if (!teacherSubject || students.length !== new Set(data.studentIds).size) throw new Error("SESSION_PARTICIPANTS_INVALID");
      const created = await tx.session.create({
        data: {
          academyId: user.academyId, teacherId: data.teacherId, subjectId: data.subjectId,
          sessionType: data.sessionType, scheduledStart: start, scheduledEnd: end,
          durationMinutes, timezone: data.timezone, zoomJoinUrl: data.zoomJoinUrl,
          zoomHostUrl: data.zoomHostUrl || null, replacementForSessionId: sourceSessionId,
          students: { create: data.studentIds.map((studentId) => ({ studentId })) },
        },
        select: { id: true, replacementForSessionId: true },
      });
      for (const studentId of new Set(data.studentIds)) {
        if (!(await reserveCredit(tx, user.academyId, studentId, created.id))) throw new Error("INSUFFICIENT_SESSION_CREDIT");
      }
      return created;
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ data: replacement }, { status: 201 });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "INSUFFICIENT_SESSION_CREDIT") return NextResponse.json({ error: { code: "INSUFFICIENT_SESSION_CREDIT", message: "One or more students do not have an available session credit." } }, { status: 409 });
    if (cause instanceof Error && cause.message === "SESSION_PARTICIPANTS_INVALID") return NextResponse.json({ error: { code: "CONFLICT", message: "Teacher, subject, or students are not valid for this academy." } }, { status: 409 });
    throw cause;
  }
}
