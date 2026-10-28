import { readFileSync } from "node:fs";
import { join } from "node:path";

import { computeIndicators, getAcademyIndicators, getTeacherIndicators, monthRangeUtc, parseMonthParam } from "../../lib/performance/teacher-indicators";
import { prisma } from "../../lib/prisma";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * S-11 / D7 teacher performance indicators (owner, 2026-10-27). Per month in the
 * teacher's zone: late start = the teacher's FIRST platform join click later than
 * start + 5 min (no click is shown separately, never guessed); report on time = FIRST
 * submission ≤ end + 15 min; monthly reports submitted. No combined score. The
 * teacher sees only their own data; complaints and evaluations never appear.
 */
jest.setTimeout(180_000);

const MIN = 60_000;
const CAIRO = "Africa/Cairo";
let fx: SessionFixtures;

function row(overrides: Partial<Parameters<typeof computeIndicators>[0]["sessions"][number]> = {}) {
  const start = new Date("2026-10-20T15:00:00Z");
  return {
    id: "s",
    scheduledStart: start,
    scheduledEnd: new Date(start.getTime() + 60 * MIN),
    firstClickAt: new Date(start.getTime() + 2 * MIN),
    rosterCount: 1,
    reportFirstSubmittedAt: [new Date(start.getTime() + 70 * MIN)],
    ...overrides,
  };
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-11 teacher indicators (D7)", () => {
  it("PF-01: late start is the first click after start + 5 min; exactly +5 is on time; no click is counted apart", () => {
    const start = new Date("2026-10-20T15:00:00Z");
    const result = computeIndicators({
      sessions: [
        row({ id: "a", firstClickAt: new Date(start.getTime() + 5 * MIN) }),
        row({ id: "b", firstClickAt: new Date(start.getTime() + 6 * MIN) }),
        row({ id: "c", firstClickAt: null }),
      ],
      monthlyReportsSubmitted: 0,
    });
    expect(result).toMatchObject({ sessionsHeld: 3, lateStarts: 1, noClick: 1 });
    expect(result.details.find((detail) => detail.id === "b")?.lateStart).toBe(true);
  });

  it("PF-02: report on time = first submission ≤ end + 15 min; missing reports counted; no combined score", () => {
    const end = new Date("2026-10-20T16:00:00Z");
    const result = computeIndicators({
      sessions: [
        row({ id: "a", rosterCount: 2, reportFirstSubmittedAt: [new Date(end.getTime() + 15 * MIN), new Date(end.getTime() + 16 * MIN)] }),
        row({ id: "b", rosterCount: 1, reportFirstSubmittedAt: [] }),
      ],
      monthlyReportsSubmitted: 4,
    });
    expect(result).toMatchObject({ reportsExpected: 3, reportsOnTime: 1, reportsLate: 1, reportsMissing: 1, monthlyReportsSubmitted: 4 });
    expect(JSON.stringify(result)).not.toMatch(/score/i);
  });

  it("PF-03: the month is the viewer's calendar month (Cairo, across the DST change); ?month= falls back to the current month", () => {
    expect(monthRangeUtc("2026-10", CAIRO)).toEqual({ start: new Date("2026-09-30T21:00:00Z"), end: new Date("2026-10-31T22:00:00Z") });
    expect(parseMonthParam("2026-09", new Date("2026-10-27T12:00:00Z"), CAIRO)).toBe("2026-09");
    expect(parseMonthParam("2026-13", new Date("2026-10-31T22:30:00Z"), CAIRO)).toBe("2026-11");
  });

  it("PF-04: DB — only the teacher's own ended, held sessions; only the TEACHER's clicks; the first report submission time", async () => {
    const now = Date.now();
    const make = (teacherId: string, startAgoMin: number, status: "SCHEDULED" | "CANCELLED" = "SCHEDULED") =>
      prisma.session.create({
        data: {
          academyId: fx.academyId, teacherId, subjectId: fx.subjectId, sessionType: "PRIVATE",
          scheduledStart: new Date(now - startAgoMin * MIN), scheduledEnd: new Date(now - (startAgoMin - 60) * MIN), durationMinutes: 60,
          timezone: CAIRO, zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status,
          students: { create: [{ studentId: fx.studentProfileIds.student1 }] },
        },
        select: { id: true, scheduledStart: true, scheduledEnd: true },
      });
    const held = await make(fx.teacherProfileId, 180);
    await make(fx.teacherProfileId, 300, "CANCELLED");
    await make(fx.teacherProfileId, -60); // not ended yet
    await make(fx.teacher2ProfileId, 180);
    await prisma.sessionJoinClick.createMany({
      data: [
        { academyId: fx.academyId, sessionId: held.id, userId: fx.studentUserIds.student1, clickedAt: new Date(held.scheduledStart.getTime() - 10 * MIN) },
        { academyId: fx.academyId, sessionId: held.id, userId: fx.teacherUserId, clickedAt: new Date(held.scheduledStart.getTime() + 8 * MIN) },
        { academyId: fx.academyId, sessionId: held.id, userId: fx.teacherUserId, clickedAt: new Date(held.scheduledStart.getTime() + 20 * MIN) },
      ],
    });
    await prisma.report.create({
      data: {
        academyId: fx.academyId, sessionId: held.id, studentId: fx.studentProfileIds.student1, teacherId: fx.teacherProfileId,
        reportType: "SESSION_COMPLETION_REPORT", attendanceOutcome: "ATTENDED", classRemark: "good", summary: "Covered.", homework: "Page 1.",
        createdAt: new Date(held.scheduledEnd.getTime() + 10 * MIN), submittedAt: new Date(held.scheduledEnd.getTime() + 90 * MIN),
      },
    });
    const month = parseMonthParam(undefined, new Date(now - 180 * MIN), CAIRO);
    const mine = await getTeacherIndicators(fx.academyId, fx.teacherProfileId, month, CAIRO);
    expect(mine).toMatchObject({ sessionsHeld: 1, lateStarts: 1, noClick: 0, reportsExpected: 1, reportsOnTime: 1 });
    expect(mine.details[0].firstClickAt?.toISOString()).toBe(new Date(held.scheduledStart.getTime() + 8 * MIN).toISOString());
    const academy = await getAcademyIndicators(fx.academyId, month, CAIRO);
    expect(academy.find((entry) => entry.teacherId === fx.teacher2ProfileId)).toMatchObject({ sessionsHeld: 1, noClick: 1, reportsMissing: 1 });
  });

  it("PF-05 (static): the teacher page reads only the signed-in teacher; Admin page is Admin-only; no complaints/evaluations", () => {
    const teacherPage = readFileSync(join(process.cwd(), "app/[locale]/teacher/indicators/page.tsx"), "utf8");
    expect(teacherPage).toMatch(/requireRole\("TEACHER"\)/);
    expect(teacherPage).toMatch(/where: \{ userId: user\.id \}/);
    const adminPage = readFileSync(join(process.cwd(), "app/[locale]/admin/performance/page.tsx"), "utf8");
    expect(adminPage).toMatch(/requireRole\("ADMIN"\)/);
    const lib = readFileSync(join(process.cwd(), "lib/performance/teacher-indicators.ts"), "utf8");
    for (const source of [teacherPage, lib]) expect(source).not.toMatch(/complaint|evaluation/i);
  });
  it("PF-06 (A7, owner 2026-10-28): D7 stays; the teacher page says a session is counted after its scheduled end", () => {
    const teacherPage = readFileSync(join(process.cwd(), "app/[locale]/teacher/indicators/page.tsx"), "utf8");
    expect(teacherPage).toContain('t("countedAfterEnd")');
    for (const locale of ["en", "ar"]) {
      const messages = JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), "utf8"));
      expect(typeof messages.performance.countedAfterEnd).toBe("string");
    }
  });
});
