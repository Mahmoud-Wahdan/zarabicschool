import "server-only";

import { prisma } from "../prisma";
import { zonedDayRangeUtc, zonedYmd } from "../schedules/recurrence";

/**
 * Admin home "today's sessions" (A7, 2026-10-28). Today = the viewer's own calendar
 * day (`timeZone`), every status (a cancelled session still shows with its status),
 * ordered by start. No row cap: the old `take: 8` hid every later session of a busy
 * day (and cut the day's totals); the totals here always count the whole day.
 */
export async function getTodaySessions(academyId: string, now: Date, timeZone: string) {
  const { start, end } = zonedDayRangeUtc(zonedYmd(now, timeZone), timeZone);
  const sessions = await prisma.session.findMany({
    where: { academyId, scheduledStart: { gte: start, lt: end } },
    orderBy: { scheduledStart: "asc" },
    include: {
      subject: { select: { nameAr: true, nameEn: true } },
      teacher: { select: { user: { select: { displayName: true } } } },
      students: { include: { student: { select: { user: { select: { displayName: true } } } } } },
    },
  });
  return {
    sessions,
    total: sessions.length,
    completed: sessions.filter((session) => session.status === "COMPLETED").length,
    upcoming: sessions.filter((session) => session.status === "SCHEDULED").length,
  };
}
