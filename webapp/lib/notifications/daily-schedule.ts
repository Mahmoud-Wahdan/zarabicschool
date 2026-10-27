import "server-only";

import type { Prisma } from "../../generated/prisma/client";

import { prisma } from "../prisma";
import { formatDateTime } from "../schedules/display";
import { wallClockInputToUtc, zonedDayRangeUtc, zonedYmd } from "../schedules/recurrence";

/**
 * Daily teacher WhatsApp schedule (S-08 / D5, wording D31, owner 2026-10-27):
 * - planned at the teacher's local midnight (any tick from 00:00 to before 08:00
 *   local), one job per teacher per local date, only when the teacher has a session
 *   that day; payload `{ localDate }` only — the text is composed at send time;
 * - one line per session (a group session = one line), make-ups (replacement
 *   sessions) listed separately; cancelled/missed sessions are left out;
 * - never sent at or after 08:00 local (the worker cancels a late job); changes
 *   after that are shown in-app only (the teacher's "Today" list);
 * - no links, ever.
 */
export const DAILY_SCHEDULE_KIND = "DAILY_SCHEDULE";
export const DAILY_SCHEDULE_CUTOFF_HOUR = 8;

export type DailyScheduleSession = {
  scheduledStart: Date;
  durationMinutes: number;
  sessionType: string;
  studentNames: string[];
  isMakeUp: boolean;
};

export function withinDailyScheduleWindow(now: Date, localDate: string, timeZone: string): boolean {
  const cutoff = `${localDate}T${String(DAILY_SCHEDULE_CUTOFF_HOUR).padStart(2, "0")}:00`;
  return zonedYmd(now, timeZone) === localDate && now.getTime() < wallClockInputToUtc(cutoff, timeZone).getTime();
}

export function composeDailySchedule(input: {
  name: string;
  academyName: string;
  localDate: string;
  timeZone: string;
  language: "ar" | "en";
  sessions: DailyScheduleSession[];
}): string {
  const { language, timeZone } = input;
  // A calendar date (not an instant): formatted from UTC noon so no zone shifts the day.
  const dateNoon = `${input.localDate}T12:00:00Z`;
  const weekday = formatDateTime(dateNoon, "UTC", language, { weekday: "long" });
  const date = formatDateTime(dateNoon, "UTC", language, { day: "numeric", month: "long" });
  const line = (session: DailyScheduleSession, index: number) => {
    const at = formatDateTime(session.scheduledStart, timeZone, language, { hour: "numeric", minute: "2-digit" });
    const who =
      session.sessionType === "GROUP"
        ? language === "en"
          ? `Group (${session.studentNames.length} students)`
          : `مجموعة (${session.studentNames.length} طلاب)`
        : session.studentNames[0] ?? "";
    return language === "en"
      ? `${index + 1}. ${who} - ${session.durationMinutes} minutes at ${at}`
      : `${index + 1}. ${who} - ${session.durationMinutes} دقيقة الساعة ${at}`;
  };
  const regular = input.sessions.filter((session) => !session.isMakeUp);
  const makeUps = input.sessions.filter((session) => session.isMakeUp);
  return [
    language === "en" ? `Good morning ${input.name},` : `صباح الخير يا ${input.name}،`,
    language === "en" ? `Your schedule today, ${weekday} ${date}:` : `جدولك اليوم ${weekday} ${date}:`,
    ...regular.map(line),
    ...(makeUps.length ? [language === "en" ? "Make-up sessions:" : "حصص التعويض:", ...makeUps.map(line)] : []),
    language === "en" ? "Have a blessed day." : "نتمنى لك يومًا مباركًا.",
    input.academyName,
  ].join("\n");
}

async function teacherDaySessions(teacherUserId: string, academyId: string, localDate: string, timeZone: string) {
  const range = zonedDayRangeUtc(localDate, timeZone);
  return prisma.session.findMany({
    where: {
      academyId,
      teacher: { userId: teacherUserId },
      status: { notIn: ["CANCELLED", "MISSED"] },
      scheduledStart: { gte: range.start, lt: range.end },
    },
    orderBy: { scheduledStart: "asc" },
    select: {
      scheduledStart: true,
      durationMinutes: true,
      sessionType: true,
      replacementForSessionId: true,
      students: { select: { student: { select: { user: { select: { displayName: true } } } } } },
    },
  });
}

/** The text for one teacher and local date, composed at send time; null when there is nothing to send. */
export async function buildDailyScheduleMessage(teacherUserId: string, academyId: string, localDate: string): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: { id: teacherUserId, academyId },
    select: { displayName: true, preferredLanguage: true, timezone: true, academy: { select: { name: true } } },
  });
  if (!user) return null;
  const timeZone = user.timezone || "Africa/Cairo";
  const sessions = await teacherDaySessions(teacherUserId, academyId, localDate, timeZone);
  if (!sessions.length) return null;
  return composeDailySchedule({
    name: user.displayName,
    academyName: user.academy.name,
    localDate,
    timeZone,
    language: user.preferredLanguage === "en" ? "en" : "ar",
    sessions: sessions.map((session) => ({
      scheduledStart: session.scheduledStart,
      durationMinutes: session.durationMinutes,
      sessionType: session.sessionType,
      studentNames: session.students.map((entry) => entry.student.user.displayName),
      isMakeUp: session.replacementForSessionId !== null,
    })),
  });
}

/** Worker step: one DAILY_SCHEDULE job per active teacher with a session on their current local date. */
export async function planDailySchedules(now = new Date(), academyId?: string) {
  const teachers = await prisma.teacher.findMany({
    where: { user: { isActive: true }, ...(academyId ? { academyId } : {}) },
    select: { id: true, academyId: true, user: { select: { id: true, timezone: true } } },
  });
  const jobs: Prisma.NotificationJobCreateManyInput[] = [];
  for (const teacher of teachers) {
    const timeZone = teacher.user.timezone || "Africa/Cairo";
    const localDate = zonedYmd(now, timeZone);
    if (!withinDailyScheduleWindow(now, localDate, timeZone)) continue;
    const range = zonedDayRangeUtc(localDate, timeZone);
    const count = await prisma.session.count({
      where: { academyId: teacher.academyId, teacherId: teacher.id, status: { notIn: ["CANCELLED", "MISSED"] }, scheduledStart: { gte: range.start, lt: range.end } },
    });
    if (count === 0) continue;
    jobs.push({
      academyId: teacher.academyId,
      sessionId: null,
      recipientUserId: teacher.user.id,
      kind: DAILY_SCHEDULE_KIND,
      dedupKey: `${DAILY_SCHEDULE_KIND}:${teacher.id}:${localDate}`,
      scheduledFor: now,
      payload: { localDate },
    });
  }
  if (jobs.length) await prisma.notificationJob.createMany({ data: jobs, skipDuplicates: true });
}
