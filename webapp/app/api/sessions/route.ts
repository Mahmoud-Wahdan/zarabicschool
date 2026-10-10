import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { reserveCredit, runSerializable } from "../../../lib/credits/reservation";
import { enqueueSessionJobs } from "../../../lib/notifications/session-jobs";
import { sessionCreateSchema } from "../../../lib/validation/management";

export async function GET(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const url = new URL(request.url);
  const sessions = await prisma.session.findMany({
    where: {
      academyId: user.academyId,
      ...(user.role === "TEACHER" ? { teacher: { userId: user.id } } : {}),
      ...(user.role === "STUDENT" ? { students: { some: { student: { userId: user.id } } } } : {}),
      ...(user.role === "GUARDIAN" ? { students: { some: { student: { guardian: { userId: user.id } } } } } : {}),
      ...(url.searchParams.get("status") ? { status: url.searchParams.get("status") as never } : {}),
    },
    orderBy: { scheduledStart: "asc" },
    take: 100,
    include: {
      subject: { select: { nameAr: true, nameEn: true } },
      teacher: { select: { user: { select: { displayName: true } } } },
      students: { select: { studentId: true, attendanceStatus: true, student: { select: { user: { select: { displayName: true } } } } } },
    },
  });
  const data = sessions.map(({ zoomHostUrl, ...session }) => ({
    ...session,
    ...(user.role === "ADMIN" || user.role === "SUPERVISOR" || user.role === "TEACHER" ? { zoomHostUrl } : {}),
  }));
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = sessionCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid session details.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  const data = parsed.data;
  const start = new Date(data.scheduledStart);
  const end = new Date(data.scheduledEnd);
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (durationMinutes <= 0 || durationMinutes > 720) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Session duration must be between 1 and 720 minutes." } }, { status: 400 });
  }
  if (data.sessionType === "PRIVATE" && data.studentIds.length !== 1) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Private sessions require exactly one student." } }, { status: 400 });
  }
  const uniqueStudentIds = [...new Set(data.studentIds)];
  if (uniqueStudentIds.length !== data.studentIds.length) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "A student cannot be selected twice." } }, { status: 400 });
  }
  try {
    const session = await runSerializable(async (tx) => {
      const teacherSubject = await tx.teacherSubject.findFirst({
        where: { academyId: user.academyId, teacherId: data.teacherId, subjectId: data.subjectId },
      });
      const students = await tx.student.findMany({
        where: { id: { in: uniqueStudentIds }, academyId: user.academyId, user: { isActive: true } },
        select: { id: true },
      });
      if (!teacherSubject || students.length !== uniqueStudentIds.length) throw new Error("SESSION_PARTICIPANTS_INVALID");
      const created = await tx.session.create({
        data: {
          academyId: user.academyId,
          teacherId: data.teacherId,
          subjectId: data.subjectId,
          sessionType: data.sessionType,
          scheduledStart: start,
          scheduledEnd: end,
          durationMinutes,
          timezone: data.timezone,
          zoomJoinUrl: data.zoomJoinUrl,
          zoomHostUrl: data.zoomHostUrl || null,
          createdById: user.id,
          students: { create: uniqueStudentIds.map((studentId) => ({ studentId })) },
        },
        select: { id: true },
      });
      const recipients = await tx.session.findUniqueOrThrow({
        where: { id: created.id },
        select: {
          teacher: { select: { userId: true } },
          students: {
            select: {
              student: {
                select: {
                  userId: true,
                  guardian: { select: { userId: true } },
                },
              },
            },
          },
        },
      });
      await enqueueSessionJobs(
        tx,
        user.academyId,
        created.id,
        start,
        recipients.teacher.userId,
        recipients.students.map(({ student }) => student.userId),
        recipients.students.flatMap(({ student }) => student.guardian ? [student.guardian.userId] : []),
      );
      for (const studentId of uniqueStudentIds) {
        if (!(await reserveCredit(tx, user.academyId, studentId, created.id, start))) throw new Error("INSUFFICIENT_SESSION_CREDIT");
      }
      return created;
    });
    return NextResponse.json({ data: session }, { status: 201 });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "INSUFFICIENT_SESSION_CREDIT") {
      return NextResponse.json({ error: { code: "INSUFFICIENT_SESSION_CREDIT", message: "One or more students do not have an available session credit." } }, { status: 409 });
    }
    if (cause instanceof Error && cause.message === "SESSION_PARTICIPANTS_INVALID") {
      return NextResponse.json({ error: { code: "CONFLICT", message: "Teacher, subject, or students are not valid for this academy." } }, { status: 409 });
    }
    throw cause;
  }
}
