import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { runSerializable } from "../../../../lib/credits/reservation";
import { SchedulingValidationError, resolveParticipants } from "../../../../lib/scheduling/checks";
import { zonedWallClock } from "../../../../lib/schedules/recurrence";
import { generateSeriesWeek, type SeriesForGeneration } from "../../../../lib/schedules/series";
import { recurringSessionSchema } from "../../../../lib/validation/management";
import { validateZoomUrl, zoomUrlReasonMessages } from "../../../../lib/validation/zoom-url";

export async function POST(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = recurringSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid recurring session details.", fields: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }

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
  const studentIds = [...new Set(data.studentIds)];
  if (studentIds.length !== data.studentIds.length) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "A student cannot be selected twice." } }, { status: 400 });
  }
  const zoomResult = validateZoomUrl(data.zoomJoinUrl);
  if (!zoomResult.ok) {
    return NextResponse.json(
      { error: { code: "INVALID_ZOOM_URL", message: `${zoomUrlReasonMessages[zoomResult.reason]} This is a format check only; it does not verify that the meeting exists.` } },
      { status: 400 },
    );
  }
  if (data.zoomHostUrl) {
    const hostResult = validateZoomUrl(data.zoomHostUrl);
    if (!hostResult.ok) {
      return NextResponse.json(
        { error: { code: "INVALID_ZOOM_URL", message: `${zoomUrlReasonMessages[hostResult.reason]} This is a format check only; it does not verify that the meeting exists.` } },
        { status: 400 },
      );
    }
  }
  if (start.getTime() <= Date.now()) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "The first session must start in the future." } }, { status: 400 });
  }

  const recurrenceRule = {
    scheduledStart: data.scheduledStart,
    scheduledEnd: data.scheduledEnd,
    zoomJoinUrl: data.zoomJoinUrl,
    zoomHostUrl: data.zoomHostUrl || null,
    studentIds,
    assignmentOverride: data.assignmentOverrideReason
      ? { overriddenById: user.id, reason: data.assignmentOverrideReason }
      : null,
  };

  try {
    const result = await runSerializable(async (tx) => {
      await resolveParticipants(tx, {
        academyId: user.academyId,
        teacherId: data.teacherId,
        subjectId: data.subjectId,
        studentIds,
        assignmentOverrideReason: data.assignmentOverrideReason,
      });

      const series = await tx.recurrenceSeries.create({
        data: {
          academyId: user.academyId,
          teacherId: data.teacherId,
          subjectId: data.subjectId,
          sessionType: data.sessionType,
          timezone: data.timezone,
          startDate: zonedWallClock(start, data.timezone),
          totalWeeks: data.weekCount,
          recurrenceRule,
          createdById: user.id,
        },
        select: { id: true },
      });

      const seriesRecord: SeriesForGeneration = {
        id: series.id,
        academyId: user.academyId,
        teacherId: data.teacherId,
        subjectId: data.subjectId,
        sessionType: data.sessionType,
        timezone: data.timezone,
        totalWeeks: data.weekCount,
        createdById: user.id,
        recurrenceRule,
      };

      const created: { id: string; scheduledStart: Date }[] = [];
      let paused = false;
      for (let index = 0; index < data.weekCount; index += 1) {
        const outcome = await generateSeriesWeek(tx, seriesRecord, index);
        if (outcome.outcome === "paused") {
          paused = true;
          break;
        }
        created.push({ id: outcome.sessionId, scheduledStart: outcome.sessionStart });
      }
      return { seriesId: series.id, sessions: created, paused };
    });
    return NextResponse.json({ data: result }, { status: 201 });
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
