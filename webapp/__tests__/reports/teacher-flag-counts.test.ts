import { prisma } from "../../lib/prisma";
import { getTeacherFlagCounts } from "../../lib/reports/teacher-flag-counts";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Dashboard flag counts (owner 2026-10-27, review #5 option a): the red-mark tile
 * counts LATE session reports only — matching the reports queue it links to — and
 * missing monthly reports are counted separately. Per-run test academy only.
 */
jest.setTimeout(120_000);

let fx: SessionFixtures;

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

it("FLG-01: late session-report flags and missing-monthly flags are counted separately, per academy", async () => {
  const end = new Date(Date.now() - 2 * 3600 * 1000);
  const session = await prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
      scheduledStart: new Date(end.getTime() - 3600 * 1000), scheduledEnd: end, durationMinutes: 60, timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status: "SCHEDULED",
      students: { create: [{ studentId: fx.studentProfileIds.student1 }] },
    },
    select: { id: true },
  });
  await prisma.teacherFlag.createMany({
    data: [
      { academyId: fx.academyId, teacherId: fx.teacherProfileId, flagType: "LATE_REPORT", sessionId: session.id },
      { academyId: fx.academyId, teacherId: fx.teacherProfileId, flagType: "MONTHLY_REPORT_MISSING", monthKey: "2026-09" },
      { academyId: fx.academyId, teacherId: fx.teacher2ProfileId, flagType: "MONTHLY_REPORT_MISSING", monthKey: "2026-09" },
    ],
  });
  expect(await getTeacherFlagCounts(fx.academyId)).toEqual({ lateReports: 1, missingMonthly: 2 });
  expect(await getTeacherFlagCounts(fx.foreignAcademyId)).toEqual({ lateReports: 0, missingMonthly: 0 });
});
