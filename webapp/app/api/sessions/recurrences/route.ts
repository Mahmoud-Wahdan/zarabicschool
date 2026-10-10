import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { runSerializable } from "../../../../lib/credits/reservation";
import { zonedWallClock } from "../../../../lib/schedules/recurrence";
import { generateSeriesWeek, type SeriesForGeneration } from "../../../../lib/schedules/series";
import { recurringSessionSchema } from "../../../../lib/validation/management";

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

  const recurrenceRule = {
    scheduledStart: data.scheduledStart,
    scheduledEnd: data.scheduledEnd,
    zoomJoinUrl: data.zoomJoinUrl,
    zoomHostUrl: data.zoomHostUrl || null,
    studentIds,
  };

  try {
    const result = await runSerializable(async (tx) => {
      const teacherSubject = await tx.teacherSubject.findFirst({
        where: { academyId: user.academyId, teacherId: data.teacherId, subjectId: data.subjectId },
      });
      const students = await tx.student.findMany({
        where: { id: { in: studentIds }, academyId: user.academyId, user: { isActive: true } },
        select: { id: true },
      });
      if (!teacherSubject || students.length !== studentIds.length) throw new Error("SESSION_PARTICIPANTS_INVALID");

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
      for (let index = 0; index < data.weekCount; index += 1) {
        const outcome = await generateSeriesWeek(tx, seriesRecord, index);
        if (outcome.outcome === "paused") break;
        created.push({ id: outcome.sessionId, scheduledStart: outcome.sessionStart });
      }
      return { seriesId: series.id, sessions: created };
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "SESSION_PARTICIPANTS_INVALID") {
      return NextResponse.json({ error: { code: "CONFLICT", message: "Teacher, subject, or students are not valid for this academy." } }, { status: 409 });
    }
    throw cause;
  }
}
