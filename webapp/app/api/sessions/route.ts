import { NextResponse } from "next/server";
import type { Prisma } from "../../../generated/prisma/client";

import { requireApiRoles } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { sessionCreateSchema } from "../../../lib/validation/management";

export async function reserveCredit(
  tx: Prisma.TransactionClient,
  academyId: string,
  studentId: string,
  sessionId: string,
) {
  const subscriptions = await tx.subscription.findMany({
    where: { academyId, studentId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    include: {
      ledgerEntries: { select: { sessionsDelta: true } },
      reservations: { where: { status: "RESERVED" }, select: { id: true } },
    },
  });
  const subscription = subscriptions.find((item) => {
    const balance = item.ledgerEntries.reduce((total, entry) => total + entry.sessionsDelta, 0);
    return balance - item.reservations.length > 0;
  });
  if (!subscription) return false;
  await tx.sessionReservation.create({
    data: { academyId, sessionId, studentId, subscriptionId: subscription.id },
  });
  return true;
}

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
  return NextResponse.json({ data: sessions });
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
    const session = await prisma.$transaction(async (tx) => {
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
          students: { create: uniqueStudentIds.map((studentId) => ({ studentId })) },
        },
        select: { id: true },
      });
      for (const studentId of uniqueStudentIds) {
        if (!(await reserveCredit(tx, user.academyId, studentId, created.id))) throw new Error("INSUFFICIENT_SESSION_CREDIT");
      }
      return created;
    }, { isolationLevel: "Serializable" });
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
