import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTodaySessions } from "../../lib/dashboard/today-sessions";
import { prisma } from "../../lib/prisma";
import { zonedDayRangeUtc, zonedYmd } from "../../lib/schedules/recurrence";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * A7 (owner, 2026-10-28): the Admin home "today's sessions" table showed no row for a
 * session just created for today (20:00 Cairo). Diagnosis: "today" is the viewer's
 * local day (correct) and every status is included, but the query had `take: 8`, so
 * on a day with more than 8 sessions the later ones (and the day's totals) were cut.
 * Per-run test academy only.
 */
jest.setTimeout(180_000);

const CAIRO = "Africa/Cairo";
const HOUR = 3600 * 1000;
let fx: SessionFixtures;

/** A Cairo wall-clock time today as an instant (DST-safe through the day range helper). */
function cairoToday(hour: number, minute = 0) {
  const { start } = zonedDayRangeUtc(zonedYmd(new Date(), CAIRO), CAIRO);
  return new Date(start.getTime() + (hour * 60 + minute) * 60 * 1000);
}

async function session(start: Date, status: "SCHEDULED" | "COMPLETED" | "CANCELLED" = "SCHEDULED") {
  return prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
      scheduledStart: start, scheduledEnd: new Date(start.getTime() + HOUR / 2), durationMinutes: 30, timezone: CAIRO,
      zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status,
      students: { create: [{ studentId: fx.studentProfileIds.student1 }] },
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Admin home: today's sessions (A7)", () => {
  it("TS-01: a session today at 20:00 Cairo is listed even after 9 earlier sessions; the day's totals count all of them", async () => {
    for (let index = 0; index < 9; index++) await session(cairoToday(8 + index), index < 3 ? "COMPLETED" : index === 3 ? "CANCELLED" : "SCHEDULED");
    const evening = await session(cairoToday(20));
    const today = await getTodaySessions(fx.academyId, new Date(), CAIRO);
    expect(today.sessions.map((row) => row.id)).toContain(evening.id);
    expect(today.sessions).toHaveLength(10);
    expect(today.total).toBe(10);
    expect(today.completed).toBe(3);
    expect(today.upcoming).toBe(6);
    // Ordered by start; the cancelled one is still listed with its status.
    expect(today.sessions.at(-1)!.id).toBe(evening.id);
    expect(today.sessions.some((row) => row.status === "CANCELLED")).toBe(true);
  });

  it("TS-02: the day is the viewer's own calendar day (Cairo midnight bounds, not UTC)", async () => {
    const lastNight = await session(new Date(cairoToday(0).getTime() - 30 * 60 * 1000)); // 23:30 Cairo yesterday
    const tonight = await session(cairoToday(23, 30));
    const ids = (await getTodaySessions(fx.academyId, new Date(), CAIRO)).sessions.map((row) => row.id);
    expect(ids).toContain(tonight.id);
    expect(ids).not.toContain(lastNight.id);
    // A viewer in Tokyo (UTC+9) sees 23:30 Cairo as tomorrow morning: not in their today.
    const tokyoIds = (await getTodaySessions(fx.academyId, cairoToday(12), "Asia/Tokyo")).sessions.map((row) => row.id);
    expect(tokyoIds).not.toContain(tonight.id);
  });

  it("TS-03: another academy's sessions never appear", async () => {
    const rows = (await getTodaySessions(fx.foreignAcademyId, new Date(), CAIRO)).sessions;
    expect(rows).toEqual([]);
  });

  it("TS-04 (static): the Admin home reads today's sessions from getTodaySessions (no row cap in the page)", () => {
    const page = readFileSync(join(process.cwd(), "app/[locale]/admin/page.tsx"), "utf8");
    expect(page).toMatch(/getTodaySessions\(/);
    expect(page).not.toMatch(/take:\s*8/);
  });
});
