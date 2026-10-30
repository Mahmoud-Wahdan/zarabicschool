import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * L2c (2026-10-28): with the database remote (Supabase, ~70 ms per round trip), each
 * group of queries a page waits for in sequence costs at least one round trip.
 * Measured (production, scripts/perf/waves.mjs): teacher home 9–11 waves, student
 * home 6–7, Admin home 4–7. Independent reads now start together; reads that need
 * an earlier result stay after it. These checks keep the grouping from regressing.
 */
const page = (path: string) => readFileSync(join(process.cwd(), `app/[locale]/${path}/page.tsx`), "utf8");

describe("independent page queries run together (L2c)", () => {
  it("PW-01: teacher home reads the join window, the teacher's day and the locale in one Promise.all", () => {
    expect(page("teacher")).toMatch(/Promise\.all\(\[\s*getJoinWindowMinutes\(user\.academyId\),\s*prisma\.teacher\.findUnique\(/);
    // Next session, calendar, reports to write and the monthly reminder only need the teacher: together.
    expect(page("teacher")).toMatch(/Promise\.all\(\[\s*teacher \? getTeacherNextSession\(/);
  });

  it("PW-02: student home reads the finance flag and the student together", () => {
    expect(page("student")).toMatch(/Promise\.all\(\[\s*studentFinanceBlocked\(user\.id\),/);
  });

  it("PW-03: Admin home loads the cards, money, revenue, today and the calendar in ONE Promise.all", () => {
    const admin = page("admin");
    expect(admin.match(/await Promise\.all\(/g)).toHaveLength(1);
    for (const read of ["getAdminActionCounts", "getMonthMoney", "getEgpRevenue", "getTodaySessions", "getCalendarRangeSessions"]) {
      expect(admin).toMatch(new RegExp(`${read}\\(`));
    }
  });
});
