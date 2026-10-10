import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { reserveCredit, runSerializable } from "../../../../../lib/credits/reservation";
import { SchedulingValidationError, assertTeacherFree, resolveParticipants } from "../../../../../lib/scheduling/checks";
import { replacementSessionSchema } from "../../../../../lib/validation/management";
import { validateZoomUrl, zoomUrlReasonMessages } from "../../../../../lib/validation/zoom-url";

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
  const joinZoom = validateZoomUrl(data.zoomJoinUrl);
  if (!joinZoom.ok) {
    return NextResponse.json(
      { error: { code: "INVALID_ZOOM_URL", message: `${zoomUrlReasonMessages[joinZoom.reason]} This is a format check only; it does not verify that the meeting exists.` } },
      { status: 400 },
    );
  }
  if (data.zoomHostUrl) {
    const hostZoom = validateZoomUrl(data.zoomHostUrl);
    if (!hostZoom.ok) {
      return NextResponse.json(
        { error: { code: "INVALID_ZOOM_URL", message: `${zoomUrlReasonMessages[hostZoom.reason]} This is a format check only; it does not verify that the meeting exists.` } },
        { status: 400 },
      );
    }
  }
  try {
    const replacement = await runSerializable(async (tx) => {
      const participants = await resolveParticipants(tx, {
        academyId: user.academyId,
        teacherId: data.teacherId,
        subjectId: data.subjectId,
        studentIds: data.studentIds,
        assignmentOverrideReason: data.assignmentOverrideReason,
      });
      await assertTeacherFree(tx, user.academyId, data.teacherId, start, end);
      const replacementStudentIds = [...new Set(data.studentIds)];
      await tx.sessionReservation.updateMany({
        where: { sessionId: sourceSessionId, studentId: { in: replacementStudentIds }, status: "RESERVED" },
        data: { status: "RELEASED", releasedAt: new Date() },
      });
      const created = await tx.session.create({
        data: {
          academyId: user.academyId, teacherId: data.teacherId, subjectId: data.subjectId,
          sessionType: data.sessionType, scheduledStart: start, scheduledEnd: end,
          durationMinutes, timezone: data.timezone, zoomJoinUrl: data.zoomJoinUrl,
          zoomHostUrl: data.zoomHostUrl || null,
          assignmentOverriddenById: participants.overrodeAssignment ? user.id : null,
          assignmentOverrideReason: participants.overrodeAssignment ? data.assignmentOverrideReason : null,
          replacementForSessionId: sourceSessionId,
          createdById: user.id,
          students: { create: data.studentIds.map((studentId) => ({ studentId })) },
        },
        select: { id: true, replacementForSessionId: true },
      });
      const insufficientStudentIds: string[] = [];
      for (const studentId of new Set(data.studentIds)) {
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
    return NextResponse.json({ data: replacement }, { status: 201 });
  } catch (cause) {
    if (cause instanceof SchedulingValidationError) {
      return NextResponse.json(
        {
          error: {
            code: cause.code,
            message: cause.message,
            ...(cause.studentIds ? { studentIds: cause.studentIds } : {}),
          },
        },
        { status: 409 },
      );
    }
    throw cause;
  }
}
