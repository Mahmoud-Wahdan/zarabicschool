import type { Prisma, RecurrenceSeries } from "../../generated/prisma/client";

import { addWeeksInTimeZone } from "./recurrence";
import { reserveCredit } from "../credits/reservation";
import { enqueueSeriesPausedFlag, enqueueSessionJobs } from "../notifications/session-jobs";

export type SeriesRecurrenceRule = {
  scheduledStart: string;
  scheduledEnd: string;
  zoomJoinUrl: string;
  zoomHostUrl: string | null;
  studentIds: string[];
};

export type SeriesForGeneration = Pick<
  RecurrenceSeries,
  "id" | "academyId" | "teacherId" | "subjectId" | "sessionType" | "timezone" | "totalWeeks" | "createdById"
> & { recurrenceRule: SeriesRecurrenceRule };

export type SeriesWeekOutcome =
  | { outcome: "generated"; sessionId: string; sessionStart: Date }
  | { outcome: "paused" };

export async function generateSeriesWeek(
  tx: Prisma.TransactionClient,
  series: SeriesForGeneration,
  weekIndex: number,
): Promise<SeriesWeekOutcome> {
  const rule = series.recurrenceRule;
  const anchorStart = new Date(rule.scheduledStart);
  const anchorEnd = new Date(rule.scheduledEnd);
  const sessionStart = addWeeksInTimeZone(anchorStart, weekIndex, series.timezone);
  const sessionEnd = addWeeksInTimeZone(anchorEnd, weekIndex, series.timezone);
  const durationMinutes = Math.round((sessionEnd.getTime() - sessionStart.getTime()) / 60000);
  const studentIds = rule.studentIds;

  const session = await tx.session.create({
    data: {
      academyId: series.academyId,
      teacherId: series.teacherId,
      subjectId: series.subjectId,
      sessionType: series.sessionType,
      scheduledStart: sessionStart,
      scheduledEnd: sessionEnd,
      durationMinutes,
      timezone: series.timezone,
      zoomJoinUrl: rule.zoomJoinUrl,
      zoomHostUrl: rule.zoomHostUrl,
      recurrenceGroupId: series.id,
      recurrenceWeekIndex: weekIndex,
      createdById: series.createdById,
      students: { create: studentIds.map((studentId) => ({ studentId })) },
    },
    select: { id: true },
  });

  let reservedAll = true;
  for (const studentId of studentIds) {
    if (!(await reserveCredit(tx, series.academyId, studentId, session.id, sessionStart))) {
      reservedAll = false;
      break;
    }
  }

  if (!reservedAll) {
    await tx.sessionReservation.deleteMany({ where: { sessionId: session.id } });
    await tx.sessionStudent.deleteMany({ where: { sessionId: session.id } });
    await tx.session.delete({ where: { id: session.id } });
    await tx.recurrenceSeries.update({
      where: { id: series.id },
      data: { generatedThroughWeek: weekIndex - 1, status: "PAUSED" },
    });
    await enqueueSeriesPausedFlag(tx, series.academyId, series.id, weekIndex);
    return { outcome: "paused" };
  }

  const teacher = await tx.teacher.findFirst({
    where: { id: series.teacherId },
    select: { userId: true },
  });
  const students = await tx.student.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, userId: true, guardian: { select: { userId: true } } },
  });
  await enqueueSessionJobs(
    tx,
    series.academyId,
    session.id,
    sessionStart,
    teacher?.userId ?? series.createdById,
    students.map((student) => student.userId),
    students.flatMap((student) => (student.guardian ? [student.guardian.userId] : [])),
  );

  await tx.recurrenceSeries.update({
    where: { id: series.id },
    data: {
      generatedThroughWeek: weekIndex,
      status: weekIndex === series.totalWeeks - 1 ? "COMPLETED" : "ACTIVE",
    },
  });
  return { outcome: "generated", sessionId: session.id, sessionStart };
}
