jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

import { getAcademyAnalytics } from "../../lib/analytics/academy";
import { prisma } from "../../lib/prisma";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Analytics page numbers (owner, 2026-10-31). Fixed "now" (Wed 14 Oct 2026, Cairo);
 * sessions placed in known weeks/months of a per-run test academy, so every count,
 * rate and hour total is checked against hand-computed values.
 */
jest.setTimeout(120_000);

const CAIRO = "Africa/Cairo";
const NOW = new Date("2026-10-14T10:00:00Z"); // Wed; its week starts Sat 10 Oct
let fx: SessionFixtures;

async function session(startIso: string, minutes: number, status: "SCHEDULED" | "COMPLETED" | "MISSED" | "CANCELLED", studentId: string) {
  const start = new Date(startIso);
  return prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
      scheduledStart: start, scheduledEnd: new Date(start.getTime() + minutes * 60_000), durationMinutes: minutes, timezone: CAIRO,
      zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status,
      students: { create: [{ studentId }] },
    },
    select: { id: true },
  });
}

async function report(sessionId: string, studentId: string, attendanceOutcome: "ATTENDED" | "STUDENT_ABSENT") {
  await prisma.report.create({
    data: {
      academyId: fx.academyId, sessionId, studentId, teacherId: fx.teacherProfileId, reportType: "SESSION_COMPLETION_REPORT",
      status: "SUBMITTED", attendanceOutcome, classRemark: "ok", summary: "Analytics test report.", homework: "-",
    },
  });
}

beforeAll(async () => {
  fx = await createSessionFixtures();
  const s = fx.studentProfileIds;
  // This week (Sat 10 Oct – Fri 16 Oct): 2 completed (60 + 90 min), 1 missed, 1 scheduled, 1 cancelled.
  const a = await session("2026-10-10T08:00:00Z", 60, "COMPLETED", s.student1);
  const b = await session("2026-10-11T08:00:00Z", 90, "COMPLETED", s.student2);
  const c = await session("2026-10-12T08:00:00Z", 60, "MISSED", s.student3);
  await session("2026-10-15T08:00:00Z", 60, "SCHEDULED", s.student4);
  await session("2026-10-15T10:00:00Z", 60, "CANCELLED", s.student5);
  // Previous week (Sat 3 Oct): 1 completed.
  const d = await session("2026-10-04T08:00:00Z", 30, "COMPLETED", s.student1);
  // Last month (September): completed, outside this month's totals but inside the 12 weeks.
  await session("2026-09-20T08:00:00Z", 60, "COMPLETED", s.student1);
  await report(a.id, s.student1, "ATTENDED");
  await report(b.id, s.student2, "ATTENDED");
  await report(c.id, s.student3, "STUDENT_ABSENT");
  await report(d.id, s.student1, "ATTENDED");
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("academy analytics", () => {
  it("AN-01: weekly status counts and attendance per Saturday-start week", async () => {
    const data = await getAcademyAnalytics(fx.academyId, NOW, CAIRO);
    expect(data.weeks).toHaveLength(12);
    const thisWeek = data.weeks[data.weeks.length - 1];
    expect(thisWeek).toMatchObject({ weekStart: "2026-10-10", completed: 2, missed: 1, scheduled: 1, cancelled: 1, attended: 2, reported: 3 });
    expect(data.weeks[data.weeks.length - 2]).toMatchObject({ weekStart: "2026-10-03", completed: 1, attended: 1, reported: 1 });
  });

  it("AN-02: this month's summary, hours per teacher (completed only) and sessions per subject (not cancelled)", async () => {
    const data = await getAcademyAnalytics(fx.academyId, NOW, CAIRO);
    expect(data.month).toBe("2026-10");
    expect(data.summary).toMatchObject({ completed: 3, missed: 1 });
    expect(data.summary.hours).toBeCloseTo(3); // 60 + 90 + 30 minutes
    expect(data.summary.attendanceRate).toBeCloseTo(3 / 4);
    expect(data.teacherHours).toEqual([{ name: expect.any(String), hours: 3 }]);
    expect(data.subjectSessions.map((row) => row.count)).toEqual([5]); // 3 completed + 1 missed + 1 scheduled
  });

  it("AN-03: another academy's sessions never appear", async () => {
    const data = await getAcademyAnalytics(fx.foreignAcademyId, NOW, CAIRO);
    expect(data.weeks.reduce((sum, week) => sum + week.completed + week.missed + week.scheduled + week.cancelled, 0)).toBe(0);
  });
});
