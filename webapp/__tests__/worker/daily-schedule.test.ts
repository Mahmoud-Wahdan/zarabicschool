import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildDailyScheduleMessage,
  composeDailySchedule,
  planDailySchedules,
  withinDailyScheduleWindow,
} from "../../lib/notifications/daily-schedule";
import { processDueNotificationJobs } from "../../lib/worker/notifications";
import { formatDateTime } from "../../lib/schedules/display";
import { prisma } from "../../lib/prisma";
import { fakeMessaging } from "../helpers/fake-messaging";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * S-08 daily teacher WhatsApp schedule (D5, wording D31, owner 2026-10-27): planned
 * at the teacher's local midnight, one line per session (a group = one line),
 * make-ups listed separately, never sent at or after 08:00 local, no links, payload
 * `{localDate}` only; later changes show in-app only. Per-run test academy only;
 * the fake messaging provider is installed for every suite.
 */
jest.setTimeout(180_000);

const CAIRO = "Africa/Cairo";
let fx: SessionFixtures;

const time = (iso: string, language: "ar" | "en") => formatDateTime(iso, CAIRO, language, { hour: "numeric", minute: "2-digit" });

async function session(startIso: string, studentIds: string[], options: { status?: "SCHEDULED" | "CANCELLED"; makeUpFor?: string } = {}) {
  const start = new Date(startIso);
  return prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId,
      sessionType: studentIds.length > 1 ? "GROUP" : "PRIVATE",
      scheduledStart: start, scheduledEnd: new Date(start.getTime() + 45 * 60 * 1000), durationMinutes: 45, timezone: CAIRO,
      zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status: options.status ?? "SCHEDULED",
      replacementForSessionId: options.makeUpFor ?? null,
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

describe("S-08 daily teacher schedule", () => {
  const sample = {
    name: "Mona",
    academyName: "Madarak",
    localDate: "2026-10-30",
    timeZone: CAIRO,
    sessions: [
      { scheduledStart: new Date("2026-10-30T07:00:00Z"), durationMinutes: 45, sessionType: "PRIVATE", studentNames: ["Ali"], isMakeUp: false },
      { scheduledStart: new Date("2026-10-30T09:00:00Z"), durationMinutes: 60, sessionType: "GROUP", studentNames: ["Sara", "Omar", "Laila"], isMakeUp: false },
      { scheduledStart: new Date("2026-10-30T15:00:00Z"), durationMinutes: 30, sessionType: "PRIVATE", studentNames: ["Hana"], isMakeUp: true },
    ],
  };

  it("DS-01: the Arabic text is the approved D31 wording, one line per session, make-ups apart", () => {
    const text = composeDailySchedule({ ...sample, language: "ar" });
    const weekday = formatDateTime("2026-10-30T12:00:00Z", "UTC", "ar", { weekday: "long" });
    const date = formatDateTime("2026-10-30T12:00:00Z", "UTC", "ar", { day: "numeric", month: "long" });
    expect(text.split("\n")).toEqual([
      "صباح الخير يا Mona،",
      `جدولك اليوم ${weekday} ${date}:`,
      `1. Ali - 45 دقيقة الساعة ${time("2026-10-30T07:00:00Z", "ar")}`,
      `2. مجموعة (3 طلاب) - 60 دقيقة الساعة ${time("2026-10-30T09:00:00Z", "ar")}`,
      "حصص التعويض:",
      `1. Hana - 30 دقيقة الساعة ${time("2026-10-30T15:00:00Z", "ar")}`,
      "نتمنى لك يومًا مباركًا.",
      "Madarak",
    ]);
  });

  it("DS-02: English mirrors the Arabic line by line; no link anywhere", () => {
    const text = composeDailySchedule({ ...sample, language: "en" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Good morning Mona,");
    expect(lines[2]).toBe(`1. Ali - 45 minutes at ${time("2026-10-30T07:00:00Z", "en")}`);
    expect(lines[3]).toBe(`2. Group (3 students) - 60 minutes at ${time("2026-10-30T09:00:00Z", "en")}`);
    expect(lines[4]).toBe("Make-up sessions:");
    expect(lines.at(-2)).toBe("Have a blessed day.");
    for (const language of ["ar", "en"] as const) expect(composeDailySchedule({ ...sample, language })).not.toMatch(/https?:|zoom|www\./i);
  });

  it("DS-03: the send window is local midnight to before 08:00 on that local date (Cairo DST)", () => {
    expect(withinDailyScheduleWindow(new Date("2026-10-29T22:10:00Z"), "2026-10-30", CAIRO)).toBe(true); // 00:10 EET
    expect(withinDailyScheduleWindow(new Date("2026-10-30T05:59:00Z"), "2026-10-30", CAIRO)).toBe(true); // 07:59
    expect(withinDailyScheduleWindow(new Date("2026-10-30T06:00:00Z"), "2026-10-30", CAIRO)).toBe(false); // 08:00
    expect(withinDailyScheduleWindow(new Date("2026-10-26T21:10:00Z"), "2026-10-27", CAIRO)).toBe(true); // 00:10 EEST
    expect(withinDailyScheduleWindow(new Date("2026-10-27T05:00:00Z"), "2026-10-27", CAIRO)).toBe(false); // 08:00 EEST
  });

  it("DS-04: planning makes one job per teacher with sessions that day, payload {localDate} only, idempotent; none after 08:00", async () => {
    const day = "2026-12-03";
    await session("2026-12-03T08:00:00Z", [fx.studentProfileIds.student1]);
    const atMidnight = new Date("2026-12-02T22:05:00Z"); // 00:05 Cairo on 3 Dec
    await planDailySchedules(atMidnight, fx.academyId);
    await planDailySchedules(atMidnight, fx.academyId);
    const jobs = await prisma.notificationJob.findMany({ where: { academyId: fx.academyId, kind: "DAILY_SCHEDULE" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ recipientUserId: fx.teacherUserId, payload: { localDate: day }, sessionId: null });
    await planDailySchedules(new Date("2026-12-04T07:00:00Z"), fx.academyId); // 09:00 Cairo on 4 Dec
    expect(await prisma.notificationJob.count({ where: { academyId: fx.academyId, kind: "DAILY_SCHEDULE" } })).toBe(1);
  });

  it("DS-05: a job picked up at or after 08:00 local is cancelled, never sent", async () => {
    fakeMessaging.reset();
    const job = await prisma.notificationJob.create({
      data: {
        academyId: fx.academyId, recipientUserId: fx.teacherUserId, kind: "DAILY_SCHEDULE",
        dedupKey: `DAILY_SCHEDULE:test-late:${Date.now()}`, scheduledFor: new Date("2026-12-05T00:00:00Z"), payload: { localDate: "2026-12-05" },
      },
    });
    await processDueNotificationJobs(new Date("2026-12-05T06:30:00Z"), fx.academyId); // 08:30 Cairo
    const after = await prisma.notificationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("CANCELLED");
    expect(fakeMessaging.sent.filter((record) => record.userId === fx.teacherUserId)).toHaveLength(0);
  });

  it("DS-06: the message lists that local day's sessions in the teacher's zone, skips cancelled ones, make-ups apart", async () => {
    const original = await session("2026-12-09T08:00:00Z", [fx.studentProfileIds.student2], { status: "CANCELLED" });
    await session("2026-12-09T10:00:00Z", [fx.studentProfileIds.student3, fx.studentProfileIds.student4]);
    await session("2026-12-09T12:00:00Z", [fx.studentProfileIds.student2], { makeUpFor: original.id });
    await session("2026-12-09T22:30:00Z", [fx.studentProfileIds.student5]); // 00:30 on 10 Dec in Cairo
    await prisma.user.update({ where: { id: fx.teacherUserId }, data: { preferredLanguage: "en", timezone: CAIRO } });
    const text = await buildDailyScheduleMessage(fx.teacherUserId, fx.academyId, "2026-12-09");
    expect(text).not.toBeNull();
    const lines = text!.split("\n");
    expect(lines[2]).toBe(`1. Group (2 students) - 45 minutes at ${time("2026-12-09T10:00:00Z", "en")}`);
    expect(lines[3]).toBe("Make-up sessions:");
    expect(lines[4]).toMatch(/^1\. .+ - 45 minutes at /);
    expect(lines).toHaveLength(7);
  });

  it("DS-07 (static): the in-app 'Today' list on the teacher's sessions page covers changes after midnight", () => {
    const page = readFileSync(join(process.cwd(), "app/[locale]/teacher/sessions/page.tsx"), "utf8");
    expect(page).toMatch(/t\("teacher\.today"\)/);
    const worker = readFileSync(join(process.cwd(), "lib/worker/notifications.ts"), "utf8");
    expect(worker).toMatch(/planDailySchedules\(now, academyId\)/);
  });
});
