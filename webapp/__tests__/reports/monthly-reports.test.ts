jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { prisma } from "../../lib/prisma";
import { GET as listMonthlyReportsRoute, POST as createMonthlyReportRoute } from "../../app/api/monthly-reports/route";
import { processMonthlyReportReminders } from "../../lib/worker/notifications";
import {
  computeRescheduledSessions,
  eligibleMonthlyStudents,
  isMonthlyReportEditable,
} from "../../lib/reports/monthly";
import { currentMonthKey, monthKeyRangeUtc, previousMonthKey } from "../../lib/reports/month-key";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

const getServerSessionMock = getServerSession as jest.Mock;

jest.setTimeout(180_000);

let fx: SessionFixtures;

const currentMonth = currentMonthKey("UTC");
const previousMonth = previousMonthKey(currentMonth);

function nextMonthKey(monthKey: string): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}
const nextMonth = nextMonthKey(currentMonth);

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function apiRequest(path: string, method: string, body?: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function monthlyPayload(overrides: Record<string, unknown> = {}) {
  return {
    monthKey: previousMonth,
    studentId: "",
    achievement: "Completed the month's memorization plan with strong recitation.",
    learningProgress: "EXCELLENT",
    classFocus: "OFTEN",
    homeworkCompletion: "MOST_OF_THE_TIME",
    punctuality: "ALWAYS",
    supportAreas: "",
    nextMonthObjectives: "Begin the next surah with daily review.",
    language: "en",
    ...overrides,
  };
}

async function postMonthlyReport(actorId: string, payload: unknown) {
  asActor(actorId);
  const response = await createMonthlyReportRoute(apiRequest("/api/monthly-reports", "POST", payload));
  return { status: response.status, body: await response.json() };
}

async function listMonthlyReports(actorId: string, query = "") {
  asActor(actorId);
  const response = await listMonthlyReportsRoute(apiRequest(`/api/monthly-reports${query}`, "GET"));
  return { status: response.status, body: await response.json() };
}

/** A session whose scheduledStart falls inside the monthKey's UTC range (status defaults to SCHEDULED). */
async function createSessionInMonth(options: {
  studentProfileIds: string[];
  monthKey: string;
  teacherProfileId?: string;
  dayOffset?: number;
  status?: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "MISSED";
  replacementForSessionId?: string;
}) {
  const { start } = monthKeyRangeUtc(options.monthKey);
  const when = new Date(start.getTime() + (options.dayOffset ?? 5) * 24 * 60 * 60 * 1000);
  return prisma.session.create({
    data: {
      academyId: fx.academyId,
      teacherId: options.teacherProfileId ?? fx.teacherProfileId,
      subjectId: fx.subjectId,
      sessionType: options.studentProfileIds.length > 1 ? "GROUP" : "PRIVATE",
      scheduledStart: when,
      scheduledEnd: new Date(when.getTime() + 60 * 60 * 1000),
      durationMinutes: 60,
      timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/345678901234",
      createdById: fx.adminUserId,
      status: options.status ?? "SCHEDULED",
      ...(options.replacementForSessionId ? { replacementForSessionId: options.replacementForSessionId } : {}),
      students: { create: options.studentProfileIds.map((studentId) => ({ studentId })) },
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) {
    // MonthlyReport has a RESTRICT FK to the academy — delete before the shared
    // fixture cleanup (cleanupSessionFixtures does not know this table).
    await prisma.monthlyReport.deleteMany({ where: { academyId: { in: [fx.academyId, fx.foreignAcademyId] } } });
    await cleanupSessionFixtures(fx);
  }
  await closePrisma();
});

describe("Session 1 — monthly report rules (unit layer)", () => {
  it("UNIT-MON-01: rejects a month that has not started yet", async () => {
    const { status, body } = await postMonthlyReport(
      fx.teacherUserId,
      monthlyPayload({ monthKey: nextMonth, studentId: fx.studentProfileIds.student1 }),
    );
    expect(status).toBe(409);
    expect(body.error.code).toBe("MONTH_NOT_STARTED");
  });

  it("UNIT-MON-02: accepts the current month (a month that has started)", async () => {
    await createSessionInMonth({ studentProfileIds: [fx.studentProfileIds.student2], monthKey: currentMonth });
    const { status, body } = await postMonthlyReport(
      fx.teacherUserId,
      monthlyPayload({ monthKey: currentMonth, studentId: fx.studentProfileIds.student2 }),
    );
    expect(status).toBe(201);
    expect(body.data.monthKey).toBe(currentMonth);
  });

  it("UNIT-MON-03: the 7-day edit window is still open 6 days after submission", () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    const sixAndAHalfDaysLater = new Date("2026-01-07T12:00:00.000Z");
    expect(isMonthlyReportEditable(submittedAt, sixAndAHalfDaysLater)).toBe(true);
  });

  it("UNIT-MON-04: the 7-day edit window is closed 8 days after submission", () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    const eightDaysLater = new Date("2026-01-09T00:00:00.000Z");
    expect(isMonthlyReportEditable(submittedAt, eightDaysLater)).toBe(false);
  });

  it("UNIT-MON-05: rescheduled count comes from replacement sessions only — never double-counts approved requests", async () => {
    // Real flow: an approved outage request creates the replacement session.
    const source = await createSessionInMonth({ studentProfileIds: [fx.studentProfileIds.student11], monthKey: previousMonth, dayOffset: 5 });
    const replacement = await createSessionInMonth({
      studentProfileIds: [fx.studentProfileIds.student11],
      monthKey: previousMonth,
      dayOffset: 10,
      replacementForSessionId: source.id,
    });
    await prisma.sessionRequest.create({
      data: {
        academyId: fx.academyId,
        sessionId: source.id,
        requestedById: fx.studentUserIds.student11,
        reason: "Test outage — approved, replacement created.",
        status: "APPROVED",
        reviewedById: fx.adminUserId,
        reviewedAt: new Date(),
        replacementSessionId: replacement.id,
      },
    });
    // A second approved request WITHOUT a replacement must add nothing (never both).
    const plain = await createSessionInMonth({ studentProfileIds: [fx.studentProfileIds.student11], monthKey: previousMonth, dayOffset: 15 });
    await prisma.sessionRequest.create({
      data: {
        academyId: fx.academyId,
        sessionId: plain.id,
        requestedById: fx.studentUserIds.student11,
        reason: "Test outage — approved, no replacement scheduled.",
        status: "APPROVED",
        reviewedById: fx.adminUserId,
        reviewedAt: new Date(),
      },
    });
    const count = await computeRescheduledSessions(fx.teacherProfileId, fx.studentProfileIds.student11, previousMonth);
    expect(count).toBe(1);
  });

  it("UNIT-MON-06: a payload missing required fields fails validation with the standard error shape", async () => {
    const { status, body } = await postMonthlyReport(
      fx.teacherUserId,
      monthlyPayload({ studentId: fx.studentProfileIds.student3, achievement: "", learningProgress: undefined }),
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.achievement).toBeDefined();
    expect(body.error.fields.learningProgress).toBeDefined();
  });
});

describe("Session 1 — monthly report integration (dev DB, demo_test_* cleanup)", () => {
  it("INT-MON-01: creates a report for a valid (teacher, student, month) pair with HTTP 201", async () => {
    await createSessionInMonth({ studentProfileIds: [fx.studentProfileIds.student4], monthKey: previousMonth });
    const { status, body } = await postMonthlyReport(
      fx.teacherUserId,
      monthlyPayload({ studentId: fx.studentProfileIds.student4 }),
    );
    expect(status).toBe(201);
    expect(body.data.monthKey).toBe(previousMonth);
    const row = await prisma.monthlyReport.findUniqueOrThrow({ where: { id: body.data.id } });
    expect(row.teacherId).toBe(fx.teacherProfileId);
    expect(row.studentId).toBe(fx.studentProfileIds.student4);
    expect(row.academyId).toBe(fx.academyId);
    expect(row.language).toBe("en");
    expect(row.rescheduledSessions).toBe(0);
  });

  it("INT-MON-02: a concurrent duplicate submission yields one 201 and one 409 MONTHLY_REPORT_EXISTS", async () => {
    await createSessionInMonth({ studentProfileIds: [fx.studentProfileIds.student5], monthKey: previousMonth });
    const payload = monthlyPayload({ studentId: fx.studentProfileIds.student5 });
    const [first, second] = await Promise.all([
      postMonthlyReport(fx.teacherUserId, payload),
      postMonthlyReport(fx.teacherUserId, payload),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe("MONTHLY_REPORT_EXISTS");
    const rows = await prisma.monthlyReport.count({
      where: { teacherId: fx.teacherProfileId, studentId: fx.studentProfileIds.student5, monthKey: previousMonth },
    });
    expect(rows).toBe(1);
  });

  it("INT-MON-03: a report older than the 7-day edit window answers MONTHLY_REPORT_LOCKED", async () => {
    await createSessionInMonth({ studentProfileIds: [fx.studentProfileIds.student6], monthKey: previousMonth });
    await prisma.monthlyReport.create({
      data: {
        academyId: fx.academyId,
        teacherId: fx.teacherProfileId,
        studentId: fx.studentProfileIds.student6,
        monthKey: previousMonth,
        achievement: "Submitted long ago.",
        learningProgress: "GOOD",
        classFocus: "OFTEN",
        homeworkCompletion: "SOMETIMES",
        punctuality: "OFTEN",
        submittedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      },
    });
    const { status, body } = await postMonthlyReport(
      fx.teacherUserId,
      monthlyPayload({ studentId: fx.studentProfileIds.student6 }),
    );
    expect(status).toBe(409);
    expect(body.error.code).toBe("MONTHLY_REPORT_LOCKED");
  });

  it("INT-MON-04: admin and supervisor queries are academy-scoped; the per-teacher missing list derives from the shared eligible-pair logic", async () => {
    // Teacher 1: student7 (reported) + student8 (missing). Teacher 2: student9 (reported).
    await createSessionInMonth({ studentProfileIds: [fx.studentProfileIds.student7], monthKey: previousMonth, dayOffset: 6 });
    await createSessionInMonth({ studentProfileIds: [fx.studentProfileIds.student8], monthKey: previousMonth, dayOffset: 7 });
    await createSessionInMonth({ studentProfileIds: [fx.studentProfileIds.student9], monthKey: previousMonth, dayOffset: 8, teacherProfileId: fx.teacher2ProfileId });
    const reportA = await postMonthlyReport(fx.teacherUserId, monthlyPayload({ studentId: fx.studentProfileIds.student7 }));
    expect(reportA.status).toBe(201);
    const reportB = await postMonthlyReport(fx.teacher2UserId, monthlyPayload({ studentId: fx.studentProfileIds.student9 }));
    expect(reportB.status).toBe(201);

    const adminList = await listMonthlyReports(fx.adminUserId, `?monthKey=${previousMonth}`);
    expect(adminList.status).toBe(200);
    const adminIds = adminList.body.data.map((row: { id: string }) => row.id);
    expect(adminIds).toContain(reportA.body.data.id);
    expect(adminIds).toContain(reportB.body.data.id);

    const supervisorList = await listMonthlyReports(fx.supervisorUserId, `?monthKey=${previousMonth}`);
    expect(supervisorList.status).toBe(200);
    const supervisorIds = supervisorList.body.data.map((row: { id: string }) => row.id);
    expect(supervisorIds).toContain(reportA.body.data.id);
    expect(supervisorIds).toContain(reportB.body.data.id);

    // A teacher sees only her own reports.
    const teacherList = await listMonthlyReports(fx.teacher2UserId, `?monthKey=${previousMonth}`);
    expect(teacherList.status).toBe(200);
    expect(teacherList.body.data).toHaveLength(1);
    expect(teacherList.body.data[0].id).toBe(reportB.body.data.id);
    expect(teacherList.body.data[0].teacherId).toBe(fx.teacher2ProfileId);

    // Missing list per teacher — the same eligible-pair computation the admin page
    // and the reminders share (lib/reports/monthly.eligibleMonthlyStudents).
    const eligible = await eligibleMonthlyStudents(fx.teacherProfileId, previousMonth);
    const eligibleIds = eligible.map((entry) => entry.studentId).sort();
    expect(eligibleIds).toContain(fx.studentProfileIds.student7);
    expect(eligibleIds).toContain(fx.studentProfileIds.student8);
    const reported = new Set(
      (await prisma.monthlyReport.findMany({ where: { teacherId: fx.teacherProfileId, monthKey: previousMonth }, select: { studentId: true } })).map((row) => row.studentId),
    );
    const missing = eligible
      .filter((entry) => !reported.has(entry.studentId))
      .map((entry) => entry.studentId)
      .sort();
    // student8 has no report (this test); student11's UNIT-MON-05 sessions in the
    // same month also make the pair (teacher 1, student11) eligible and unreported.
    expect(missing).toEqual(
      [fx.studentProfileIds.student8, fx.studentProfileIds.student11].sort(),
    );
  });

  it("INT-MON-05: the reminder worker fires on days 1 and 3 only, for teachers with missing reports", async () => {
    // From INT-MON-04: teacher 1 is missing student8's report for previousMonth;
    // teacher 2 is fully reported and must get no reminder.
    const [year, month] = currentMonth.split("-").map(Number);
    const day1 = new Date(Date.UTC(year, month - 1, 1, 10, 0, 0));
    const day2 = new Date(Date.UTC(year, month - 1, 2, 10, 0, 0));
    const day3 = new Date(Date.UTC(year, month - 1, 3, 10, 0, 0));

    await processMonthlyReportReminders(day1, fx.academyId);
    const day1Job = await prisma.notificationJob.findFirstOrThrow({
      where: { kind: "MONTHLY_REPORT_REMINDER", dedupKey: `MONTHLY_REPORT_REMINDER:${fx.teacherProfileId}:${previousMonth}:d1` },
    });
    expect(day1Job.recipientUserId).toBe(fx.teacherUserId);
    expect(day1Job.academyId).toBe(fx.academyId);
    // Two missing pairs for teacher 1 at this point: student8 (this suite's
    // scoping test) and student11 (the UNIT-MON-05 replacement sessions).
    expect(day1Job.payload).toEqual({ monthKey: previousMonth, missingCount: 2 });

    // Suppressed on other days: the day-2 scan creates nothing.
    await processMonthlyReportReminders(day2, fx.academyId);
    expect(
      await prisma.notificationJob.count({ where: { kind: "MONTHLY_REPORT_REMINDER", dedupKey: { startsWith: `MONTHLY_REPORT_REMINDER:${fx.teacherProfileId}:${previousMonth}:d2` } } }),
    ).toBe(0);

    // Day 3 reminder: one more job for the still-missing report (own dedup key).
    await processMonthlyReportReminders(day3, fx.academyId);
    expect(
      await prisma.notificationJob.count({ where: { kind: "MONTHLY_REPORT_REMINDER", dedupKey: `MONTHLY_REPORT_REMINDER:${fx.teacherProfileId}:${previousMonth}:d3` } }),
    ).toBe(1);

    // No reminder for a teacher with nothing missing.
    expect(
      await prisma.notificationJob.count({ where: { kind: "MONTHLY_REPORT_REMINDER", dedupKey: { startsWith: `MONTHLY_REPORT_REMINDER:${fx.teacher2ProfileId}:` } } }),
    ).toBe(0);
  });
});
