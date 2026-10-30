import "server-only";

import {
  DEFAULT_TEACHER_HOURS_THRESHOLD,
  MAX_TEACHER_HOURS_THRESHOLD,
  MIN_TEACHER_HOURS_THRESHOLD,
  TEACHER_HOURS_THRESHOLD_KEY,
  type BoardStatus,
} from "../config/schedule-board";
import { prisma } from "../prisma";
import { zonedDayRangeUtc } from "../schedules/recurrence";
import { dayTotals } from "./board-layout";
import { parseWeekParam, shiftWeek } from "./week";

/**
 * Teacher schedule board read model (S-16, D91) — Admin and Supervisor only (the
 * routes and the page check the role). Academy-scoped, bounded (≤ 300 teachers,
 * ≤ 1000 sessions), viewer zone. It selects NO Zoom link, rate, amount or phone.
 */
const MAX_TEACHERS = 300;
const MAX_SESSIONS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BoardQuery = {
  academyId: string;
  timeZone: string;
  date: string;
  view: "day" | "week";
  teacherId?: string;
  studentId?: string;
  statuses: BoardStatus[];
};

export function isValidHoursThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_TEACHER_HOURS_THRESHOLD && value <= MAX_TEACHER_HOURS_THRESHOLD;
}

export async function getTeacherHoursThreshold(academyId: string): Promise<number> {
  const row = await prisma.academySetting.findUnique({
    where: { academyId_key: { academyId, key: TEACHER_HOURS_THRESHOLD_KEY } },
    select: { value: true },
  });
  return isValidHoursThreshold(row?.value) ? row.value : DEFAULT_TEACHER_HOURS_THRESHOLD;
}

function addDays(ymd: string, days: number) {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export async function getScheduleBoard(query: BoardQuery) {
  const days = query.view === "week"
    ? Array.from({ length: 7 }, (_, index) => addDays(parseWeekParam(query.date, new Date(), query.timeZone), index))
    : [query.date];
  const dayRanges = days.map((ymd) => ({ ymd, ...zonedDayRangeUtc(ymd, query.timeZone) }));
  const range = { start: dayRanges[0].start, end: dayRanges[dayRanges.length - 1].end };
  const thresholdHours = await getTeacherHoursThreshold(query.academyId);
  const thresholdMinutes = thresholdHours * 60;

  const [teachers, sessions] = await Promise.all([
    prisma.teacher.findMany({
      where: {
        academyId: query.academyId,
        approvalStatus: "APPROVED",
        user: { isActive: true },
        ...(query.teacherId ? { id: query.teacherId } : {}),
      },
      orderBy: { user: { displayName: "asc" } },
      take: MAX_TEACHERS,
      select: { id: true, user: { select: { displayName: true } } },
    }),
    prisma.session.findMany({
      where: {
        academyId: query.academyId,
        scheduledStart: { lt: range.end },
        scheduledEnd: { gt: range.start },
        status: { in: query.statuses },
        ...(query.teacherId ? { teacherId: query.teacherId } : {}),
        ...(query.studentId ? { students: { some: { studentId: query.studentId } } } : {}),
      },
      orderBy: [{ teacherId: "asc" }, { scheduledStart: "asc" }],
      take: MAX_SESSIONS + 1,
      select: {
        id: true,
        teacherId: true,
        scheduledStart: true,
        scheduledEnd: true,
        status: true,
        sessionType: true,
        students: { select: { student: { select: { user: { select: { displayName: true } } } } } },
      },
    }),
  ]);
  const truncated = sessions.length > MAX_SESSIONS;
  const shown = sessions.slice(0, MAX_SESSIONS);
  const view = (session: (typeof shown)[number]) => ({
    id: session.id,
    start: session.scheduledStart.toISOString(),
    end: session.scheduledEnd.toISOString(),
    status: session.status as BoardStatus,
    type: session.sessionType,
    studentNames: session.students.map((row) => row.student.user.displayName),
    studentCount: session.students.length,
    href: `/admin/sessions/${session.id}`,
  });
  const rowFor = (teacher: (typeof teachers)[number], day: (typeof dayRanges)[number]) => {
    const inDay = shown.filter((session) => session.teacherId === teacher.id && session.scheduledStart < day.end && session.scheduledEnd > day.start);
    return {
      teacherId: teacher.id,
      teacherName: teacher.user.displayName,
      day: day.ymd,
      totals: dayTotals(inDay.map((session) => ({ start: session.scheduledStart, end: session.scheduledEnd, status: session.status as BoardStatus })), day, thresholdMinutes),
      sessions: inDay.map(view),
    };
  };
  const rows = query.view === "week"
    ? teachers.slice(0, 1).flatMap((teacher) => dayRanges.map((day) => rowFor(teacher, day)))
    : teachers
        .map((teacher) => rowFor(teacher, dayRanges[0]))
        // The student filter lists only the teachers who have that student that day.
        .filter((row) => !query.studentId || row.sessions.length > 0);
  return {
    timeZone: query.timeZone,
    view: query.view,
    date: query.date,
    previous: query.view === "week" ? shiftWeek(days[0], -1) : addDays(query.date, -1),
    next: query.view === "week" ? shiftWeek(days[0], 1) : addDays(query.date, 1),
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    thresholdMinutes,
    truncated,
    rows,
  };
}

export type ScheduleBoard = Awaited<ReturnType<typeof getScheduleBoard>>;
