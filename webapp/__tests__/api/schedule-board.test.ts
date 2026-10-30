jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { GET as boardRoute } from "../../app/api/admin/schedule-board/route";
import * as thresholdRoute from "../../app/api/admin/settings/teacher-hours-threshold/route";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * S-16 (Part C, D91): the Admin/Supervisor teacher schedule board. Day view (one row per
 * teacher), week view (one teacher), filters for teacher / student / status, totals in
 * scheduled minutes (cancelled/missed never count), the Admin threshold (default 6 h),
 * viewer zone, never a Zoom link or money. Per-run test academy; sessions are written
 * directly at fixed past dates (the board is read-only).
 */
jest.setTimeout(180_000);

const getServerSessionMock = getServerSession as jest.Mock;
const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
let fx: SessionFixtures;

const CAIRO = "Africa/Cairo";
const MIN = 60_000;

async function session(input: { teacherId?: string; start: string; minutes: number; students?: string[]; type?: "PRIVATE" | "GROUP"; status?: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "MISSED"; academyId?: string; subjectId?: string; createdById?: string }) {
  const start = new Date(input.start);
  return prisma.session.create({
    data: {
      academyId: input.academyId ?? fx.academyId,
      teacherId: input.teacherId ?? fx.teacherProfileId,
      subjectId: input.subjectId ?? fx.subjectId,
      sessionType: input.type ?? "PRIVATE",
      scheduledStart: start,
      scheduledEnd: new Date(start.getTime() + input.minutes * MIN),
      durationMinutes: input.minutes,
      timezone: CAIRO,
      zoomJoinUrl: "https://zoom.us/j/909090909090",
      zoomHostUrl: "https://zoom.us/s/909090909091",
      createdById: input.createdById ?? fx.adminUserId,
      status: input.status ?? "SCHEDULED",
      students: { create: (input.students ?? [fx.studentProfileIds.student1]).map((studentId) => ({ studentId })) },
    },
    select: { id: true },
  });
}

const board = (query: string) => boardRoute(new Request(`http://localhost:3000/api/admin/schedule-board?${query}`));
type Row = { teacherId: string; teacherName: string; day: string; totals: { sessions: number; minutes: number; overThreshold: boolean }; sessions: { id: string; start: string; end: string; status: string; type: string; studentNames: string[]; studentCount: number; href: string }[] };
const rows = async (query: string) => ((await (await board(query)).json()).data.rows as Row[]);
const rowOf = (list: Row[], teacherId: string) => list.find((row) => row.teacherId === teacherId)!;

beforeAll(async () => {
  fx = await createSessionFixtures();
  await prisma.user.update({ where: { id: fx.adminUserId }, data: { timezone: CAIRO } });
  await prisma.user.update({ where: { id: fx.supervisorUserId }, data: { timezone: CAIRO } });
  // 2026-09-15 (Cairo, UTC+3): teacher has 3 private hours + a cancelled one; teacher2 one group hour.
  await session({ start: "2026-09-15T06:00:00Z", minutes: 60 }); // 09:00 Cairo
  await session({ start: "2026-09-15T08:00:00Z", minutes: 120, students: [fx.studentProfileIds.student2] }); // 11:00
  await session({ start: "2026-09-15T12:00:00Z", minutes: 60, status: "CANCELLED" }); // 15:00, never counts
  await session({ teacherId: fx.teacher2ProfileId, start: "2026-09-15T10:00:00Z", minutes: 60, type: "GROUP", students: [fx.studentProfileIds.student9, fx.studentProfileIds.student1] });
  // Another academy's session on the same day must never appear.
  await session({ academyId: fx.foreignAcademyId, teacherId: fx.foreignTeacherProfileId, subjectId: fx.foreignSubjectId, students: [fx.foreignStudentProfileId], createdById: fx.foreignAdminUserId, start: "2026-09-15T07:00:00Z", minutes: 60 });
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-16 schedule board", () => {
  it("TB-01: teacher, student and guardian get 403; anonymous gets 401", async () => {
    for (const actor of [fx.teacherUserId, fx.studentUserIds.student1, fx.guardianUserId]) {
      as(actor);
      expect((await board("date=2026-09-15")).status).toBe(403);
    }
    getServerSessionMock.mockResolvedValue(null);
    expect((await board("date=2026-09-15")).status).toBe(401);
  });

  it("TB-02: academy isolation — foreign teacher/student ids give empty rows, foreign sessions never appear", async () => {
    as(fx.adminUserId);
    const all = await rows("date=2026-09-15");
    expect(all.some((row) => row.teacherId === fx.foreignTeacherProfileId)).toBe(false);
    expect((await rows(`date=2026-09-15&teacherId=${fx.foreignTeacherProfileId}`)).length).toBe(0);
    expect((await rows(`date=2026-09-15&studentId=${fx.foreignStudentProfileId}`)).length).toBe(0);
  });

  it("TB-03: a DST day (Cairo fall-back, 2026-10-29) is 25 h and a session in the repeated hour sits in that day", async () => {
    // 21:30Z = 23:30 Cairo in the SECOND (repeated) 23:00 hour after the fall-back.
    await session({ start: "2026-10-29T21:30:00Z", minutes: 30, students: [fx.studentProfileIds.student3] });
    as(fx.adminUserId);
    const response = await (await board(`date=2026-10-29&teacherId=${fx.teacherProfileId}`)).json();
    expect(Date.parse(response.data.range.end) - Date.parse(response.data.range.start)).toBe(25 * 60 * MIN);
    const row = rowOf(response.data.rows, fx.teacherProfileId);
    expect(row.sessions.map((item) => item.start)).toContain("2026-10-29T21:30:00.000Z");
    expect(row.totals.minutes).toBe(30);
  });

  it("TB-04: no Zoom link, no money anywhere in the answer (Admin and Supervisor)", async () => {
    for (const actor of [fx.adminUserId, fx.supervisorUserId]) {
      as(actor);
      const response = await board("date=2026-09-15");
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const text = await response.text();
      for (const forbidden of ["zoom.us", "zoomJoinUrl", "zoomHostUrl", "amountMinor", "hourlyRate", "phone"]) expect(text).not.toContain(forbidden);
    }
  });

  it("TB-05: totals count scheduled minutes only; cancelled/missed never count; the threshold flags only ABOVE it", async () => {
    as(fx.adminUserId);
    const day = await rows("date=2026-09-15");
    const teacher = rowOf(day, fx.teacherProfileId);
    expect(teacher.totals).toEqual({ sessions: 2, minutes: 180, overThreshold: false });
    // Default status filter (scheduled + completed) hides the cancelled session.
    expect(teacher.sessions.map((item) => item.status)).not.toContain("CANCELLED");
    // The status filter shows it, still not counted.
    const withCancelled = rowOf(await rows("date=2026-09-15&status=SCHEDULED,CANCELLED"), fx.teacherProfileId);
    expect(withCancelled.sessions.map((item) => item.status)).toContain("CANCELLED");
    expect(withCancelled.totals.minutes).toBe(180);
    // Threshold: exactly 3 h is not above 3 h; 2 h is exceeded.
    const put = (hours: number) => thresholdRoute.PUT(new Request("http://localhost:3000/api/admin/settings/teacher-hours-threshold", { method: "PUT", headers: sameOriginHeaders({ "content-type": "application/json" }), body: JSON.stringify({ hours }) }));
    expect((await put(3)).status).toBe(200);
    expect(rowOf(await rows("date=2026-09-15"), fx.teacherProfileId).totals.overThreshold).toBe(false);
    expect((await put(2)).status).toBe(200);
    expect(rowOf(await rows("date=2026-09-15"), fx.teacherProfileId).totals.overThreshold).toBe(true);
    // Only the Admin sets it; the default is 6 h.
    as(fx.supervisorUserId);
    expect((await put(5)).status).toBe(403);
    as(fx.adminUserId);
    expect((await put(6)).status).toBe(200);
    expect((await (await board("date=2026-09-15")).json()).data.thresholdMinutes).toBe(360);
  });

  it("TB-06: the student filter shows only that student's sessions, across teachers", async () => {
    as(fx.supervisorUserId);
    const list = await rows(`date=2026-09-15&studentId=${fx.studentProfileIds.student1}`);
    expect(list.map((row) => row.teacherId).sort()).toEqual([fx.teacherProfileId, fx.teacher2ProfileId].sort());
    expect(rowOf(list, fx.teacherProfileId).sessions).toHaveLength(1);
    const group = rowOf(list, fx.teacher2ProfileId).sessions[0];
    expect(group.type).toBe("GROUP");
    expect(group.studentCount).toBe(2);
    expect(group.href).toBe(`/admin/sessions/${group.id}`);
  });

  it("TB-07: a session crossing local midnight is split between the two days' totals", async () => {
    // 2026-09-20 23:00 → 2026-09-21 01:00 Cairo (20:00Z → 22:00Z).
    await session({ teacherId: fx.teacher2ProfileId, start: "2026-09-20T20:00:00Z", minutes: 120, students: [fx.studentProfileIds.student9] });
    as(fx.adminUserId);
    expect(rowOf(await rows(`date=2026-09-20&teacherId=${fx.teacher2ProfileId}`), fx.teacher2ProfileId).totals.minutes).toBe(60);
    expect(rowOf(await rows(`date=2026-09-21&teacherId=${fx.teacher2ProfileId}`), fx.teacher2ProfileId).totals.minutes).toBe(60);
  });

  it("TB-08: the week view needs one teacher and returns its 7 days (Saturday first); bad input is 400", async () => {
    as(fx.adminUserId);
    expect((await board("date=2026-09-15&view=week")).status).toBe(400);
    expect((await board("date=not-a-date")).status).toBe(400);
    expect((await board("date=2026-09-15&status=BOGUS")).status).toBe(400);
    const week = await rows(`date=2026-09-15&view=week&teacherId=${fx.teacherProfileId}`);
    expect(week.map((row) => row.day)).toEqual(["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"]);
    expect(week.find((row) => row.day === "2026-09-15")!.totals.minutes).toBe(180);
  });
});
