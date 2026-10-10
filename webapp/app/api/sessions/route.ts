import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { reserveCredit, runSerializable } from "../../../lib/credits/reservation";
import { enqueueSessionJobs } from "../../../lib/notifications/session-jobs";
import { SchedulingValidationError, assertTeacherFree, resolveParticipants } from "../../../lib/scheduling/checks";
import { sessionCreateSchema } from "../../../lib/validation/management";
import { validateZoomUrl, zoomUrlReasonMessages } from "../../../lib/validation/zoom-url";

function zoomUrlErrorResponse(value: string) {
  const result = validateZoomUrl(value);
  if (result.ok) return null;
  return NextResponse.json(
    {
      error: {
        code: "INVALID_ZOOM_URL",
        message: `${zoomUrlReasonMessages[result.reason]} This is a format check only; it does not verify that the meeting exists.`,
      },
    },
    { status: 400 },
  );
}

function schedulingErrorResponse(error: SchedulingValidationError) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.studentIds ? { studentIds: error.studentIds } : {}),
      },
    },
    { status: 409 },
  );
}

export async function GET(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const isOperator = user.role === "ADMIN" || user.role === "SUPERVISOR";
  const statusFilter = searchParams.get("status");
  const fromFilter = searchParams.get("from");
  const toFilter = searchParams.get("to");
  const scheduledStartFilter = {
    ...(fromFilter && !Number.isNaN(new Date(fromFilter).getTime()) ? { gte: new Date(fromFilter) } : {}),
    ...(toFilter && !Number.isNaN(new Date(toFilter).getTime()) ? { lte: new Date(toFilter) } : {}),
  };
  const sessions = await prisma.session.findMany({
    where: {
      academyId: user.academyId,
      ...(user.role === "TEACHER" ? { teacher: { userId: user.id } } : {}),
      ...(user.role === "STUDENT" ? { students: { some: { student: { userId: user.id } } } } : {}),
      ...(user.role === "GUARDIAN" ? { students: { some: { student: { guardian: { userId: user.id } } } } } : {}),
      ...(statusFilter ? { status: statusFilter as never } : {}),
      ...(Object.keys(scheduledStartFilter).length ? { scheduledStart: scheduledStartFilter } : {}),
      ...(isOperator && searchParams.get("teacherId") ? { teacherId: searchParams.get("teacherId") as string } : {}),
      ...(isOperator && searchParams.get("studentId")
        ? { students: { some: { studentId: searchParams.get("studentId") as string } } }
        : {}),
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
  const zoomError = zoomUrlErrorResponse(data.zoomJoinUrl)
    ?? (data.zoomHostUrl ? zoomUrlErrorResponse(data.zoomHostUrl) : null);
  if (zoomError) return zoomError;
  if (start.getTime() <= Date.now()) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "The session start must be in the future." } }, { status: 400 });
  }
  try {
    const session = await runSerializable(async (tx) => {
      const participants = await resolveParticipants(tx, {
        academyId: user.academyId,
        teacherId: data.teacherId,
        subjectId: data.subjectId,
        studentIds: uniqueStudentIds,
        assignmentOverrideReason: data.assignmentOverrideReason,
      });
      await assertTeacherFree(tx, user.academyId, data.teacherId, start, end);
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
          assignmentOverriddenById: participants.overrodeAssignment ? user.id : null,
          assignmentOverrideReason: participants.overrodeAssignment ? data.assignmentOverrideReason : null,
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
      const insufficientStudentIds: string[] = [];
      for (const studentId of uniqueStudentIds) {
        if (!(await reserveCredit(tx, user.academyId, studentId, created.id, start))) {
          insufficientStudentIds.push(studentId);
        }
      }
      if (insufficientStudentIds.length > 0) {
        throw new SchedulingValidationError(
          "INSUFFICIENT_SESSION_CREDIT",
          "One or more students do not have an available session credit.",
          insufficientStudentIds,
        );
      }
      return created;
    });
    return NextResponse.json({ data: session }, { status: 201 });
  } catch (cause) {
    if (cause instanceof SchedulingValidationError) {
      return schedulingErrorResponse(cause);
    }
    throw cause;
  }
}
