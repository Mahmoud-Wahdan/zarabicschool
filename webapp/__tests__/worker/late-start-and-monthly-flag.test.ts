import { prisma } from "../../lib/prisma";
import { ADMIN_LATE_ALERT_MINUTES, TEACHER_LATE_REMINDER_MINUTES } from "../../lib/config/lateness";
import {
  composeJobMessage,
  processDueNotificationJobs,
  processLateStartAlerts,
  processMonthlyReportReminders,
} from "../../lib/worker/notifications";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Worker rules (Phase 8): teacher late start (LS-01..04, owner 2026-10-26: T+5 teacher
 * WhatsApp, T+10 Admin alert, SCHEDULED only, idempotent, teacher clicks only),
 * the monthly-report Admin flag (MR, days 4–7 of the teacher's month, CONFIRMED) and
 * WhatsApp join links (JL-01: never a Zoom link; platform link only inside the join
 * window). Per-run test academy only; the fake provider is installed for every suite.
 */
jest.setTimeout(180_000);

let fx: SessionFixtures;
const MINUTE = 60 * 1000;

async function session(options: { startMinutesAgo: number; durationMinutes?: number; status?: "SCHEDULED" | "COMPLETED" | "CANCELLED"; teacherProfileId?: string; start?: Date }) {
  const start = options.start ?? new Date(Date.now() - options.startMinutesAgo * MINUTE);
  const duration = options.durationMinutes ?? 60;
  return prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: options.teacherProfileId ?? fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
      scheduledStart: start, scheduledEnd: new Date(start.getTime() + duration * MINUTE), durationMinutes: duration,
      timezone: "Africa/Cairo", zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId,
      status: options.status ?? "SCHEDULED", students: { create: [{ studentId: fx.studentProfileIds.student1 }] },
    },
    select: { id: true, scheduledStart: true, scheduledEnd: true },
  });
}

const lateJobs = (sessionId: string) =>
  prisma.notificationJob.findMany({ where: { sessionId, kind: { in: ["TEACHER_LATE_START", "TEACHER_LATE_START_ADMIN"] } }, select: { kind: true, recipientUserId: true, status: true } });

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Teacher late start", () => {
  it("LS-01: T+4 → nothing; T+5 → one teacher reminder only; T+10 → one alert per active Admin; repeated scans add nothing", async () => {
    const s = await session({ startMinutesAgo: 0 });
    const at = (minutes: number) => new Date(s.scheduledStart.getTime() + minutes * MINUTE);
    await processLateStartAlerts(at(TEACHER_LATE_REMINDER_MINUTES - 1), fx.academyId);
    expect(await lateJobs(s.id)).toHaveLength(0);
    await processLateStartAlerts(at(TEACHER_LATE_REMINDER_MINUTES), fx.academyId);
    expect((await lateJobs(s.id)).map((job) => [job.kind, job.recipientUserId])).toEqual([["TEACHER_LATE_START", fx.teacherUserId]]);
    await processLateStartAlerts(at(ADMIN_LATE_ALERT_MINUTES), fx.academyId);
    await processLateStartAlerts(at(ADMIN_LATE_ALERT_MINUTES + 1), fx.academyId);
    const jobs = await lateJobs(s.id);
    expect(jobs.filter((job) => job.kind === "TEACHER_LATE_START")).toHaveLength(1);
    expect(jobs.filter((job) => job.kind === "TEACHER_LATE_START_ADMIN").map((job) => job.recipientUserId)).toEqual([fx.adminUserId]);
  });

  it("LS-02: a teacher click before sending cancels the pending reminder; a cancelled session cancels it too", async () => {
    const clickedSession = await session({ startMinutesAgo: 6 });
    await processLateStartAlerts(new Date(), fx.academyId);
    await prisma.sessionJoinClick.create({ data: { academyId: fx.academyId, sessionId: clickedSession.id, userId: fx.teacherUserId } });
    const cancelledSession = await session({ startMinutesAgo: 7 });
    await processLateStartAlerts(new Date(), fx.academyId);
    await prisma.session.update({ where: { id: cancelledSession.id }, data: { status: "CANCELLED", cancelledById: fx.adminUserId, cancellationReason: "demo test" } });
    await processDueNotificationJobs(new Date(), fx.academyId);
    expect((await lateJobs(clickedSession.id)).map((job) => job.status)).toEqual(["CANCELLED"]);
    expect((await lateJobs(cancelledSession.id)).every((job) => job.status === "CANCELLED")).toBe(true);
  });

  it("LS-03: a STUDENT click does not count, and students/guardians never receive late-start jobs", async () => {
    const s = await session({ startMinutesAgo: 12 });
    await prisma.sessionJoinClick.create({ data: { academyId: fx.academyId, sessionId: s.id, userId: fx.studentUserIds.student1 } });
    await processLateStartAlerts(new Date(), fx.academyId);
    const recipients = (await lateJobs(s.id)).map((job) => job.recipientUserId);
    expect(recipients).toContain(fx.teacherUserId);
    expect(recipients).not.toContain(fx.studentUserIds.student1);
    expect(recipients).not.toContain(fx.guardianUserId);
  });

  it("LS-04: completed/cancelled sessions and sessions that started more than 60 minutes ago are never scanned", async () => {
    const completed = await session({ startMinutesAgo: 15, status: "COMPLETED" });
    const cancelled = await session({ startMinutesAgo: 15, status: "CANCELLED" });
    const old = await session({ startMinutesAgo: 70, durationMinutes: 120 });
    await processLateStartAlerts(new Date(), fx.academyId);
    for (const s of [completed, cancelled, old]) expect(await lateJobs(s.id)).toHaveLength(0);
  });
});

describe("Monthly-report Admin flag (days 4–7, CONFIRMED)", () => {
  it("MR-01: missing reports raise ONE MONTHLY_REPORT_MISSING flag from day 4 (none on days 1–3), never twice; a teacher with nothing due gets none", async () => {
    // A session in December 2026 for teacher 1, no monthly report → missing pair.
    await session({ startMinutesAgo: 0, start: new Date(Date.UTC(2026, 11, 10, 10, 0, 0)), status: "COMPLETED" });
    const flags = () => prisma.teacherFlag.findMany({ where: { academyId: fx.academyId, flagType: "MONTHLY_REPORT_MISSING" }, select: { teacherId: true, monthKey: true } });
    for (const day of [1, 2, 3]) await processMonthlyReportReminders(new Date(Date.UTC(2027, 0, day, 10, 0, 0)), fx.academyId);
    expect(await flags()).toHaveLength(0);
    await processMonthlyReportReminders(new Date(Date.UTC(2027, 0, 4, 10, 0, 0)), fx.academyId);
    await processMonthlyReportReminders(new Date(Date.UTC(2027, 0, 5, 10, 0, 0)), fx.academyId);
    expect(await flags()).toEqual([{ teacherId: fx.teacherProfileId, monthKey: "2026-12" }]);
    // No money is involved anywhere (penalty OPEN): no payroll rows for the teacher.
    expect(await prisma.payrollLedger.count({ where: { academyId: fx.academyId, entryType: "ADMIN_ADJUSTMENT" } })).toBe(0);
  });
});

describe("WhatsApp join links (JL-01)", () => {
  const recipient = { id: "u", phone: "+201000000003", isActive: true, preferredLanguage: "en", timezone: "Africa/Cairo" };
  const saved = { app: process.env.APP_PUBLIC_URL, auth: process.env.NEXTAUTH_URL };
  afterAll(() => {
    if (saved.app === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = saved.app;
    if (saved.auth === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = saved.auth;
  });

  function job(kind: string, startOffsetMinutes: number, language: "en" | "ar" = "en") {
    const start = new Date(Date.now() + startOffsetMinutes * MINUTE);
    return {
      id: "job", kind, sessionId: "11111111-1111-4111-8111-111111111111",
      recipientUser: { ...recipient, preferredLanguage: language },
      session: { scheduledStart: start, scheduledEnd: new Date(start.getTime() + 60 * MINUTE), timezone: "Africa/Cairo", status: "SCHEDULED", subject: { nameAr: "قرآن", nameEn: "Quran" }, zoomJoinUrl: "https://zoom.us/j/999999999999" },
    } as unknown as Parameters<typeof composeJobMessage>[0];
  }

  it("JL-01: start/late-start messages carry the platform join URL, never zoom.us; the T−2h reminder has no link and says when it opens", () => {
    process.env.APP_PUBLIC_URL = "https://academy.example";
    for (const language of ["en", "ar"] as const) {
      for (const kind of ["SESSION_START", "TEACHER_LATE_START"]) {
        const text = composeJobMessage(job(kind, -6, language));
        expect(text).toContain("https://academy.example/api/sessions/11111111-1111-4111-8111-111111111111/join");
        expect(text).not.toContain("zoom.us");
      }
      const reminder = composeJobMessage(job("SESSION_REMINDER", 120, language));
      expect(reminder).not.toContain("http");
      expect(reminder).toContain("15");
    }
    delete process.env.APP_PUBLIC_URL;
    delete process.env.NEXTAUTH_URL;
    const noBase = composeJobMessage(job("SESSION_START", -6));
    expect(noBase).not.toContain("http");
    expect(noBase).not.toContain("zoom.us");
  });
});
