import "server-only";

import { prisma } from "../prisma";
import { zonedDayRangeUtc, zonedYmd } from "../schedules/recurrence";

/**
 * Admin home (owner, 2026-10-31): what needs the Admin, this month's money and the
 * week's sessions. Every range is in the viewer's own zone. Money is summed per
 * currency (never mixed); "unpaid" is PENDING invoices (invoices have no due date,
 * so nothing is called overdue).
 */
export async function getAdminActionCounts(academyId: string) {
  const [reports, applications, sessionRequests, complaints] = await Promise.all([
    prisma.report.count({ where: { academyId, status: "SUBMITTED" } }),
    prisma.application.count({ where: { academyId, status: { in: ["NEW", "REVIEWED"] } } }),
    prisma.sessionRequest.count({ where: { academyId, status: "PENDING" } }),
    prisma.complaint.count({ where: { academyId, status: { in: ["NEW", "IN_PROGRESS"] } } }),
  ]);
  return { reports, applications, sessionRequests, complaints };
}

function monthRangeUtc(now: Date, timeZone: string) {
  const [year, month] = zonedYmd(now, timeZone).split("-").map(Number);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const next = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start: zonedDayRangeUtc(first, timeZone).start, end: zonedDayRangeUtc(next, timeZone).start };
}

/** ADMIN only (money). */
export async function getMonthMoney(academyId: string, now: Date, timeZone: string) {
  const { start, end } = monthRangeUtc(now, timeZone);
  const [paid, unpaid, pastDueRenewals] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["currency"],
      where: { academyId, status: "PAID", paidAt: { gte: start, lt: end } },
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    prisma.invoice.count({ where: { academyId, status: "PENDING" } }),
    prisma.billingSubscription.count({ where: { academyId, status: "PAST_DUE" } }),
  ]);
  return {
    paid: paid
      .map((row) => ({ currency: row.currency, amountMinor: row._sum.amountMinor ?? BigInt(0), count: row._count._all }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    unpaid,
    pastDueRenewals,
  };
}

/** Today (viewer's day) through the next 6 days, every status, ordered by start. */
export async function getWeekSessions(academyId: string, now: Date, timeZone: string) {
  const start = zonedDayRangeUtc(zonedYmd(now, timeZone), timeZone).start;
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return prisma.session.findMany({
    where: { academyId, scheduledStart: { gte: start, lt: end } },
    orderBy: { scheduledStart: "asc" },
    select: {
      id: true,
      scheduledStart: true,
      scheduledEnd: true,
      status: true,
      sessionType: true,
      subject: { select: { nameAr: true, nameEn: true } },
      teacher: { select: { user: { select: { displayName: true } } } },
      students: { select: { student: { select: { user: { select: { displayName: true } } } } } },
    },
  });
}

/**
 * Supervisor home (owner, 2026-10-31): teachers with late session reports or missing
 * monthly reports, most flags first. Names and counts only (no money).
 */
export async function getTeacherAlerts(academyId: string, limit = 6) {
  const groups = await prisma.teacherFlag.groupBy({
    by: ["teacherId", "flagType"],
    where: { academyId },
    _count: { _all: true },
  });
  const byTeacher = new Map<string, { late: number; monthly: number }>();
  for (const group of groups) {
    const entry = byTeacher.get(group.teacherId) ?? { late: 0, monthly: 0 };
    if (group.flagType === "LATE_REPORT") entry.late += group._count._all;
    else entry.monthly += group._count._all;
    byTeacher.set(group.teacherId, entry);
  }
  const teachers = byTeacher.size
    ? await prisma.teacher.findMany({ where: { id: { in: [...byTeacher.keys()] } }, select: { id: true, user: { select: { displayName: true } } } })
    : [];
  return teachers
    .map((teacher) => ({ teacherId: teacher.id, name: teacher.user.displayName, ...byTeacher.get(teacher.id)! }))
    .sort((a, b) => b.late + b.monthly - (a.late + a.monthly))
    .slice(0, limit);
}
