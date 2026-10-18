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
  assignmentOverride?: { overriddenById: string; reason: string } | null;
};

/**
 * A persisted recurrence rule is unreadable/malformed (missing or invalid
 * scheduledStart/scheduledEnd, e.g. data written by an older seed). The worker
 * skips such series with a logged warning instead of throwing "Invalid time
 * value" from deep inside Intl (Phase 5 completion, 2026-10-18).
 */
export class SeriesRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeriesRuleError";
  }
}

function parseRuleInstant(value: unknown, field: string): Date {
  if (typeof value !== "string" || value.length === 0) {
    throw new SeriesRuleError(`recurrence rule is missing "${field}"`);
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new SeriesRuleError(`recurrence rule has an invalid "${field}"`);
  }
  return instant;
}

export function parseSeriesRule(raw: unknown): { rule: SeriesRecurrenceRule; anchorStart: Date; anchorEnd: Date } {
  if (!raw || typeof raw !== "object") {
    throw new SeriesRuleError("recurrence rule is not an object");
  }
  const rule = raw as Partial<SeriesRecurrenceRule> & Record<string, unknown>;
  const anchorStart = parseRuleInstant(rule.scheduledStart, "scheduledStart");
  const anchorEnd = parseRuleInstant(rule.scheduledEnd, "scheduledEnd");
  if (!Array.isArray(rule.studentIds) || rule.studentIds.length === 0) {
    throw new SeriesRuleError("recurrence rule has no students");
  }
  if (typeof rule.zoomJoinUrl !== "string" || rule.zoomJoinUrl.length === 0) {
    throw new SeriesRuleError("recurrence rule is missing the join link");
  }
  return {
    rule: rule as SeriesRecurrenceRule,
    anchorStart,
    anchorEnd,
  };
}

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
  const { rule, anchorStart, anchorEnd } = parseSeriesRule(series.recurrenceRule);
  const sessionStart = addWeeksInTimeZone(anchorStart, weekIndex, series.timezone);
  const sessionEnd = addWeeksInTimeZone(anchorEnd, weekIndex, series.timezone);
  if (Number.isNaN(sessionStart.getTime()) || Number.isNaN(sessionEnd.getTime())) {
    throw new SeriesRuleError("recurrence rule produces an invalid week start/end");
  }
  const durationMinutes = Math.round((sessionEnd.getTime() - sessionStart.getTime()) / 60000);
  if (durationMinutes <= 0) {
    throw new SeriesRuleError("recurrence rule produces a non-positive duration");
  }
  const studentIds = rule.studentIds;

  const teacherConflicts = await tx.session.findMany({
    where: {
      academyId: series.academyId,
      teacherId: series.teacherId,
      status: "SCHEDULED",
      scheduledStart: { lt: sessionEnd },
      scheduledEnd: { gt: sessionStart },
    },
    select: { id: true },
  });
  if (teacherConflicts.length > 0) {
    await tx.recurrenceSeries.update({
      where: { id: series.id },
      data: { generatedThroughWeek: weekIndex - 1, status: "PAUSED" },
    });
    await enqueueSeriesPausedFlag(tx, series.academyId, series.id, weekIndex);
    return { outcome: "paused" };
  }

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
      assignmentOverriddenById: rule.assignmentOverride?.overriddenById ?? null,
      assignmentOverrideReason: rule.assignmentOverride?.reason ?? null,
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
