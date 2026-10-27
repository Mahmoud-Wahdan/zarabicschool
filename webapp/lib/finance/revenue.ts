import "server-only";

import { buildWeek, parseWeekParam } from "../calendar/week";
import { monthRangeUtc } from "../performance/teacher-indicators";
import { prisma } from "../prisma";
import { zonedYmd } from "../schedules/recurrence";

/**
 * Admin home read model (S-11 / D8, owner 2026-10-27). Revenue = PAID invoices in
 * EGP only (no dollar conversion), bucketed by the calendar month they were paid in
 * the viewer's zone; quarterly and half-year views sum those months. Admin only —
 * the Supervisor's pages never import this module.
 */
export type RevenuePeriod = "month" | "quarter" | "half";
export type RevenueBucket = { key: string; totalMinor: bigint };

const BUCKETS: Record<RevenuePeriod, number> = { month: 12, quarter: 4, half: 4 };

export function parsePeriod(value: string | undefined): RevenuePeriod {
  return value === "quarter" || value === "half" ? value : "month";
}

function monthIndex(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return year * 12 + (month - 1);
}

function bucketKey(index: number, period: RevenuePeriod) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  if (period === "quarter") return `${year}-Q${Math.ceil(month / 3)}`;
  if (period === "half") return `${year}-H${month <= 6 ? 1 : 2}`;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** First month index covered by the window that ends with `endMonth`. */
function windowStart(endMonth: string, period: RevenuePeriod) {
  const end = monthIndex(endMonth);
  const span = period === "month" ? 1 : period === "quarter" ? 3 : 6;
  const lastBucketStart = end - (end % span);
  return lastBucketStart - (BUCKETS[period] - 1) * span;
}

export function bucketRevenue(
  rows: { paidAt: Date; amountMinor: bigint }[],
  period: RevenuePeriod,
  endMonth: string,
  timeZone: string,
): RevenueBucket[] {
  const start = windowStart(endMonth, period);
  const span = period === "month" ? 1 : period === "quarter" ? 3 : 6;
  const buckets = Array.from({ length: BUCKETS[period] }, (_, index) => ({ key: bucketKey(start + index * span, period), totalMinor: BigInt(0) }));
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const row of rows) {
    const index = monthIndex(zonedYmd(row.paidAt, timeZone).slice(0, 7));
    if (index < start || index > monthIndex(endMonth)) continue;
    const bucket = byKey.get(bucketKey(index, period));
    if (bucket) bucket.totalMinor += row.amountMinor;
  }
  return buckets;
}

export async function getEgpRevenue(academyId: string, period: RevenuePeriod, now: Date, timeZone: string) {
  const endMonth = zonedYmd(now, timeZone).slice(0, 7);
  const startIndex = windowStart(endMonth, period);
  const startKey = `${Math.floor(startIndex / 12)}-${String((startIndex % 12) + 1).padStart(2, "0")}`;
  const rows = await prisma.invoice.findMany({
    where: {
      academyId,
      status: "PAID",
      currency: "EGP",
      paidAt: { gte: monthRangeUtc(startKey, timeZone).start, lt: monthRangeUtc(endMonth, timeZone).end },
    },
    select: { paidAt: true, amountMinor: true },
  });
  return bucketRevenue(
    rows.flatMap((row) => (row.paidAt ? [{ paidAt: row.paidAt, amountMinor: row.amountMinor }] : [])),
    period,
    endMonth,
    timeZone,
  );
}

/** Home cards: active students and teachers, and sessions this week (Saturday-first, viewer zone; cancelled/missed excluded). */
export async function getHomeCounts(academyId: string, now: Date, timeZone: string) {
  const { range } = buildWeek([], parseWeekParam(undefined, now, timeZone), timeZone);
  const [students, teachers, sessionsThisWeek] = await Promise.all([
    prisma.student.count({ where: { academyId, user: { isActive: true } } }),
    prisma.teacher.count({ where: { academyId, user: { isActive: true } } }),
    prisma.session.count({
      where: { academyId, status: { notIn: ["CANCELLED", "MISSED"] }, scheduledStart: { gte: range.start, lt: range.end } },
    }),
  ]);
  return { students, teachers, sessionsThisWeek };
}
