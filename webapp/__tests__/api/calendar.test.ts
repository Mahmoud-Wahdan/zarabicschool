import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getCalendarSessions } from "../../lib/calendar/data";
import { buildWeek, parseWeekParam, teacherEntryLabel } from "../../lib/calendar/week";
import { prisma } from "../../lib/prisma";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * S-10 weekly calendar (D13, D27, D30). View-only week grid for the student, the
 * teacher and the guardian (one tab per child); times in the viewer's zone; own
 * sessions only; no Zoom URL ever reaches the calendar. Per-run test academy only.
 */
jest.setTimeout(180_000);

const CAIRO = "Africa/Cairo";
let fx: SessionFixtures;

async function session(start: string, studentIds: string[], teacherProfileId = fx.teacherProfileId) {
  const startAt = new Date(start);
  return prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: teacherProfileId, subjectId: fx.subjectId,
      sessionType: studentIds.length > 1 ? "GROUP" : "PRIVATE",
      scheduledStart: startAt, scheduledEnd: new Date(startAt.getTime() + 3600 * 1000), durationMinutes: 60,
      timezone: CAIRO, zoomJoinUrl: "https://zoom.us/j/345678901234", zoomHostUrl: "https://zoom.us/s/987654321012",
      createdById: fx.adminUserId,
      students: { create: studentIds.map((studentId) => ({ studentId })) },
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

describe("S-10 weekly calendar", () => {
  it("CAL-01: the week (Saturday first) and each entry's day/time are in the viewer's zone across the DST change", () => {
    const week = buildWeek(
      [
        { id: "a", scheduledStart: new Date("2026-10-27T15:00:00Z"), scheduledEnd: new Date("2026-10-27T16:00:00Z") },
        { id: "b", scheduledStart: new Date("2026-10-29T22:30:00Z"), scheduledEnd: new Date("2026-10-29T23:30:00Z") },
        { id: "c", scheduledStart: new Date("2026-10-30T16:00:00Z"), scheduledEnd: new Date("2026-10-30T17:00:00Z") },
      ],
      "2026-10-24",
      CAIRO,
    );
    expect(week.days.map((day) => day.ymd)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    const byDay = Object.fromEntries(week.days.map((day) => [day.ymd, day.entries.map((entry) => `${entry.id}@${entry.startTime}`)]));
    expect(byDay["2026-10-27"]).toEqual(["a@18:00"]);
    expect(byDay["2026-10-30"]).toEqual(["b@00:30", "c@18:00"]);
    expect(week.range.start.toISOString()).toBe("2026-10-23T21:00:00.000Z");
    expect(week.range.end.toISOString()).toBe("2026-10-30T22:00:00.000Z");
  });

  it("CAL-02: ?week= is normalized to the Saturday of its week; anything invalid falls back to the current week", () => {
    expect(parseWeekParam("2026-10-28", new Date("2026-10-27T12:00:00Z"), CAIRO)).toBe("2026-10-24");
    expect(parseWeekParam("2026-10-31", new Date("2026-10-27T12:00:00Z"), CAIRO)).toBe("2026-10-31");
    expect(parseWeekParam("nonsense", new Date("2026-10-27T12:00:00Z"), CAIRO)).toBe("2026-10-24");
    expect(parseWeekParam(undefined, new Date("2026-10-30T22:30:00Z"), CAIRO)).toBe("2026-10-31");
  });

  it("CAL-03: own sessions only — teacher, student, guardian (per child); a foreign or unlinked child gets nothing", async () => {
    const mine = await session("2026-11-03T15:00:00Z", [fx.studentProfileIds.student1]);
    const other = await session("2026-11-03T17:00:00Z", [fx.studentProfileIds.student2], fx.teacher2ProfileId);
    const range = { start: new Date("2026-10-31T00:00:00Z"), end: new Date("2026-11-08T00:00:00Z") };
    const teacher = await getCalendarSessions({ role: "TEACHER", userId: fx.teacherUserId, academyId: fx.academyId }, range);
    expect(teacher.map((row) => row.id)).toEqual([mine.id]);
    const student = await getCalendarSessions({ role: "STUDENT", userId: fx.studentUserIds.student2, academyId: fx.academyId }, range);
    expect(student.map((row) => row.id)).toEqual([other.id]);
    const guardianChild = (await prisma.student.findMany({ where: { guardianId: fx.guardianProfileId }, select: { id: true } }))[0]?.id;
    expect(guardianChild).toBeDefined();
    const guardian = await getCalendarSessions({ role: "GUARDIAN", userId: fx.guardianUserId, academyId: fx.academyId }, range, guardianChild);
    for (const row of guardian) expect(row.students.map((entry) => entry.studentId)).toContain(guardianChild);
    const unlinked = await getCalendarSessions({ role: "GUARDIAN", userId: fx.guardianUserId, academyId: fx.academyId }, range, fx.foreignStudentProfileId);
    expect(unlinked).toEqual([]);
  });

  it("CAL-04: no Zoom URL reaches the calendar (data rows and page/component source)", async () => {
    const range = { start: new Date("2026-10-31T00:00:00Z"), end: new Date("2026-11-08T00:00:00Z") };
    const rows = await getCalendarSessions({ role: "TEACHER", userId: fx.teacherUserId, academyId: fx.academyId }, range);
    expect(JSON.stringify(rows)).not.toMatch(/zoom/i);
    for (const file of [
      "lib/calendar/data.ts",
      "app/_components/calendar/week-calendar.tsx",
      "app/[locale]/student/calendar/page.tsx",
      "app/[locale]/teacher/calendar/page.tsx",
      "app/[locale]/guardian/calendar/page.tsx",
    ]) {
      expect(readFileSync(join(process.cwd(), file), "utf8")).not.toMatch(/zoomJoinUrl|zoomHostUrl/);
    }
  });

  it("CAL-05: teacher entries name the student (private) or 'Group (n)' with the names (D30)", () => {
    expect(teacherEntryLabel("PRIVATE", ["Mona"])).toEqual({ kind: "PRIVATE", name: "Mona", names: ["Mona"] });
    expect(teacherEntryLabel("GROUP", ["Ali", "Mona", "Sara"])).toEqual({ kind: "GROUP", count: 3, names: ["Ali", "Mona", "Sara"] });
  });
});
