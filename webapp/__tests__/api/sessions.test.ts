jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { reserveCredit } from "../../lib/credits/reservation";
import { addWeeksInTimeZone } from "../../lib/schedules/recurrence";
import { prisma } from "../../lib/prisma";
import { POST as createSessionRoute, GET as listSessionsRoute } from "../../app/api/sessions/route";
import { PATCH as updateSessionRoute } from "../../app/api/sessions/[id]/route";
import { POST as replacementRoute } from "../../app/api/sessions/[id]/replacement/route";
import { POST as recurrencesRoute } from "../../app/api/sessions/recurrences/route";
import { POST as changeRequestRoute } from "../../app/api/sessions/[id]/change-request/route";
import { GET as joinRoute } from "../../app/api/sessions/[id]/join/route";
import { PATCH as reviewChangeRequestRoute } from "../../app/api/session-change-requests/[id]/route";
import { POST as enrollRoute, DELETE as unenrollRoute } from "../../app/api/admin/enrollments/route";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

const getServerSessionMock = getServerSession as jest.Mock;

jest.setTimeout(180_000);

let fx: SessionFixtures;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function futureDate(days: number, hours: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hours, 0, 0, 0);
  return date;
}

function futureDateTime(days: number, hour: number, minutes = 0) {
  const date = futureDate(days, hour);
  date.setUTCMinutes(minutes, 0, 0);
  return date;
}

const JOIN_URL = "https://zoom.us/j/123456789012";
const HOST_URL = "https://zoom.us/s/987654321012";

function sessionPayload(overrides: Record<string, unknown> = {}, slot: { day: number; hour: number; minutes?: number } = { day: 3, hour: 10 }) {
  const start = futureDateTime(slot.day, slot.hour, slot.minutes);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    teacherId: fx.teacherProfileId,
    subjectId: fx.subjectId,
    sessionType: "PRIVATE",
    scheduledStart: start.toISOString(),
    scheduledEnd: end.toISOString(),
    timezone: "Africa/Cairo",
    zoomJoinUrl: JOIN_URL,
    studentIds: [fx.studentProfileIds.student1],
    ...overrides,
  };
}

function apiRequest(path: string, method: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function createSession(
  actorId: string,
  overrides: Record<string, unknown> = {},
  slot: { day: number; hour: number; minutes?: number } = { day: 3, hour: 10 },
) {
  asActor(actorId);
  const response = await createSessionRoute(apiRequest("/api/sessions", "POST", sessionPayload(overrides, slot)));
  return { status: response.status, body: await response.json() };
}

async function grantCredit(
  studentProfileId: string,
  sessionsDelta: number,
  packageType: "MONTHLY_PLAN" | "PAY_PER_SESSION" = "MONTHLY_PLAN",
) {
  const subscription = await prisma.subscription.create({
    data: {
      academyId: fx.academyId,
      studentId: studentProfileId,
      packageType,
      sessionsPurchased: Math.max(sessionsDelta, 0),
      totalAmountMinor: BigInt(100000),
      currency: "EGP",
      status: "ACTIVE",
      ...(packageType === "MONTHLY_PLAN"
        ? { periodStartsAt: new Date(Date.now() - 24 * 3600 * 1000), periodEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) }
        : {}),
    },
    select: { id: true },
  });
  if (sessionsDelta !== 0) {
    await prisma.subscriptionLedger.create({
      data: { academyId: fx.academyId, subscriptionId: subscription.id, entryType: "INITIAL_PURCHASE", sessionsDelta },
    });
  }
  return subscription;
}

beforeAll(async () => {
  process.env.MESSAGING_PROVIDER = "fake";
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Phase 3 — session scheduling (database-backed)", () => {
  it("scenario 1: concurrent scheduling against the last available credit allows exactly one booking", async () => {
    await grantCredit(fx.studentProfileIds.student1, 1);
    const [first, second] = await Promise.all([
      createSession(fx.adminUserId, {}, { day: 3, hour: 10 }),
      createSession(fx.adminUserId, {}, { day: 3, hour: 12 }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const activeReservations = await prisma.sessionReservation.count({
      where: { studentId: fx.studentProfileIds.student1, status: "RESERVED" },
    });
    expect(activeReservations).toBe(1);
  });

  it("scenario 2: group scheduling rolls back atomically when one student cannot reserve", async () => {
    await grantCredit(fx.studentProfileIds.student2, 2);
    const beforeSessions = await prisma.session.count({ where: { academyId: fx.academyId } });
    const { status, body } = await createSession(fx.adminUserId, {
      sessionType: "GROUP",
      studentIds: [fx.studentProfileIds.student2, fx.studentProfileIds.student3],
    }, { day: 3, hour: 14 });
    expect(status).toBe(409);
    expect(body.error?.code).toBe("INSUFFICIENT_SESSION_CREDIT");
    expect(body.error?.studentIds).toEqual([fx.studentProfileIds.student3]);
    const afterSessions = await prisma.session.count({ where: { academyId: fx.academyId } });
    expect(afterSessions).toBe(beforeSessions);
    const leftoverReservations = await prisma.sessionReservation.count({
      where: { studentId: fx.studentProfileIds.student2, status: "RESERVED" },
    });
    expect(leftoverReservations).toBe(0);
  });

  it("scenario 3: recurring series caps generation at available credit and flags the admin", async () => {
    await grantCredit(fx.studentProfileIds.student4, 2);
    const anchor = new Date(Date.now() + 2 * 3600 * 1000);
    anchor.setUTCMinutes(0, 0, 0);
    const response = await recurrencesRoute(
      apiRequest("/api/sessions/recurrences", "POST", sessionPayload({
        scheduledStart: anchor.toISOString(),
        scheduledEnd: new Date(anchor.getTime() + 3600 * 1000).toISOString(),
        studentIds: [fx.studentProfileIds.student4],
        weekCount: 5,
      })),
    );
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.data.sessions).toHaveLength(2);
    const seriesId = payload.data.seriesId as string;
    const series = await prisma.recurrenceSeries.findUniqueOrThrow({ where: { id: seriesId } });
    expect(series.status).toBe("PAUSED");
    expect(series.generatedThroughWeek).toBe(1);
    const flags = await prisma.notificationJob.findMany({
      where: { academyId: fx.academyId, kind: "SERIES_PAUSED", recipientUserId: fx.adminUserId },
    });
    expect(flags).toHaveLength(1);
    const weekJobs = await prisma.notificationJob.count({
      where: { kind: "SESSION_REMINDER", session: { recurrenceGroupId: seriesId } },
    });
    expect(weekJobs).toBeGreaterThanOrEqual(2);
  });

  it("scenario 7: double cancellation is idempotent, keeps the first canceller, and stops reminder jobs", async () => {
    await grantCredit(fx.studentProfileIds.student5, 4);
    const { body } = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student5] }, { day: 3, hour: 16 });
    const sessionId = body.data.id as string;
    const jobsBefore = await prisma.notificationJob.count({ where: { sessionId } });
    expect(jobsBefore).toBeGreaterThan(0);
    asActor(fx.adminUserId);
    const firstCancel = await updateSessionRoute(
      apiRequest(`/api/sessions/${sessionId}`, "PATCH", { status: "CANCELLED", cancellationReason: "first" }),
      routeParams(sessionId),
    );
    expect(firstCancel.status).toBe(200);
    const afterFirst = await prisma.session.findUniqueOrThrow({ where: { id: sessionId }, select: { cancelledById: true } });
    const reservationAfterFirst = await prisma.sessionReservation.findFirstOrThrow({
      where: { sessionId },
      select: { status: true, releasedAt: true },
    });
    asActor(fx.supervisorUserId);
    const secondCancel = await updateSessionRoute(
      apiRequest(`/api/sessions/${sessionId}`, "PATCH", { status: "CANCELLED", cancellationReason: "second" }),
      routeParams(sessionId),
    );
    expect(secondCancel.status).toBe(200);
    const afterSecond = await prisma.session.findUniqueOrThrow({ where: { id: sessionId }, select: { cancelledById: true } });
    expect(afterSecond.cancelledById).toBe(afterFirst.cancelledById);
    const reservationAfterSecond = await prisma.sessionReservation.findFirstOrThrow({
      where: { sessionId },
      select: { status: true, releasedAt: true },
    });
    expect(reservationAfterSecond.status).toBe("RELEASED");
    expect(reservationAfterSecond.releasedAt?.getTime()).toBe(reservationAfterFirst.releasedAt?.getTime());
    const pendingJobs = await prisma.notificationJob.count({ where: { sessionId, status: { in: ["PENDING", "PROCESSING"] } } });
    expect(pendingJobs).toBe(0);
    const cancelledJobs = await prisma.notificationJob.count({ where: { sessionId, status: "CANCELLED" } });
    expect(cancelledJobs).toBe(jobsBefore);
  });

  it("scenario 8: replacement releases the missed source reservation and reserves new credit", async () => {
    await grantCredit(fx.studentProfileIds.student6, 3);
    const { body } = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student6] }, { day: 3, hour: 18 });
    const sourceId = body.data.id as string;
    await prisma.session.update({ where: { id: sourceId }, data: { status: "MISSED" } });
    asActor(fx.adminUserId);
    const response = await replacementRoute(
      apiRequest(`/api/sessions/${sourceId}/replacement`, "POST", sessionPayload({
        scheduledStart: futureDate(5, 12).toISOString(),
        scheduledEnd: futureDate(5, 13).toISOString(),
        studentIds: [fx.studentProfileIds.student6],
      })),
      routeParams(sourceId),
    );
    expect(response.status).toBe(201);
    const sourceReservation = await prisma.sessionReservation.findFirstOrThrow({
      where: { sessionId: sourceId },
      select: { status: true },
    });
    expect(sourceReservation.status).toBe("RELEASED");
    const replacement = await prisma.session.findFirstOrThrow({
      where: { replacementForSessionId: sourceId },
      include: { reservations: { select: { status: true } } },
    });
    expect(replacement.reservations.some((reservation) => reservation.status === "RESERVED")).toBe(true);
  });

  it("scenario 9: cross-academy access is rejected and teacher scoping holds", async () => {
    await grantCredit(fx.studentProfileIds.student7, 4);
    await grantCredit(fx.studentProfileIds.student9, 4);
    const { body: firstBody } = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student7] }, { day: 3, hour: 20 });
    const sessionA = firstBody.data.id as string;
    const { body: secondBody } = await createSession(fx.adminUserId, {
      teacherId: fx.teacher2ProfileId,
      studentIds: [fx.studentProfileIds.student9],
    }, { day: 3, hour: 20 });
    const sessionB = secondBody.data.id as string;

    asActor(fx.foreignAdminUserId);
    const foreignCancel = await updateSessionRoute(
      apiRequest(`/api/sessions/${sessionA}`, "PATCH", { status: "CANCELLED" }),
      routeParams(sessionA),
    );
    expect(foreignCancel.status).toBe(404);
    const foreignList = await listSessionsRoute(new Request("http://localhost:3000/api/sessions"));
    const foreignPayload = await foreignList.json();
    expect(foreignPayload.data).toHaveLength(0);

    asActor(fx.foreignStudentUserId);
    const foreignJoin = await joinRoute(new Request(`http://localhost:3000/api/sessions/${sessionA}/join`), routeParams(sessionA));
    expect(foreignJoin.status).toBe(404);

    asActor(fx.teacher2UserId);
    const teacher2List = await listSessionsRoute(new Request("http://localhost:3000/api/sessions"));
    const teacher2Payload = await teacher2List.json();
    expect(teacher2Payload.data).toHaveLength(1);
    expect(teacher2Payload.data[0].id).toBe(sessionB);

    asActor(fx.teacherUserId);
    const teacherList = await listSessionsRoute(new Request("http://localhost:3000/api/sessions"));
    const teacherPayload = await teacherList.json();
    expect(teacherPayload.data.some((item: { id: string }) => item.id === sessionA)).toBe(true);
    expect(teacherPayload.data.some((item: { id: string }) => item.id === sessionB)).toBe(false);
  });

  it("scenario 10: teachers cannot mutate sessions but can request a change", async () => {
    await grantCredit(fx.studentProfileIds.student8, 4);
    const { body } = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student8] }, { day: 4, hour: 10 });
    const sessionId = body.data.id as string;

    asActor(fx.teacherUserId);
    const teacherCreate = await createSessionRoute(apiRequest("/api/sessions", "POST", sessionPayload()));
    expect(teacherCreate.status).toBe(403);
    const teacherPatch = await updateSessionRoute(
      apiRequest(`/api/sessions/${sessionId}`, "PATCH", { status: "CANCELLED" }),
      routeParams(sessionId),
    );
    expect(teacherPatch.status).toBe(403);

    const changeRequest = await changeRequestRoute(
      apiRequest(`/api/sessions/${sessionId}/change-request`, "POST", { reason: "I am unavailable", proposedChange: "Move to Thursday" }),
      routeParams(sessionId),
    );
    expect(changeRequest.status).toBe(201);
    const changePayload = await changeRequest.json();

    asActor(fx.studentUserIds.student1);
    const studentReview = await reviewChangeRequestRoute(
      apiRequest(`/api/session-change-requests/${changePayload.data.id}`, "PATCH", { status: "APPROVED" }),
      routeParams(changePayload.data.id),
    );
    expect(studentReview.status).toBe(403);

    asActor(fx.adminUserId);
    const review = await reviewChangeRequestRoute(
      apiRequest(`/api/session-change-requests/${changePayload.data.id}`, "PATCH", { status: "APPROVED" }),
      routeParams(changePayload.data.id),
    );
    expect(review.status).toBe(200);
    const reReview = await reviewChangeRequestRoute(
      apiRequest(`/api/session-change-requests/${changePayload.data.id}`, "PATCH", { status: "REJECTED" }),
      routeParams(changePayload.data.id),
    );
    expect(reReview.status).toBe(409);
  });

  it("scenario 11: zoom link exposure follows the role matrix and the join route is guarded", async () => {
    await grantCredit(fx.studentProfileIds.student1, 4);
    const { body } = await createSession(fx.adminUserId, {
      zoomHostUrl: HOST_URL,
      studentIds: [fx.studentProfileIds.student1],
    }, { day: 4, hour: 12 });
    const sessionId = body.data.id as string;

    asActor(fx.adminUserId);
    const adminList = await listSessionsRoute(new Request("http://localhost:3000/api/sessions"));
    const adminPayload = await adminList.json();
    const adminItem = adminPayload.data.find((item: { id: string }) => item.id === sessionId);
    expect(adminItem.zoomHostUrl).toBe(HOST_URL);
    expect(adminItem.zoomJoinUrl).toBe(JOIN_URL);

    asActor(fx.studentUserIds.student1);
    const studentList = await listSessionsRoute(new Request("http://localhost:3000/api/sessions"));
    const studentPayload = await studentList.json();
    const studentItem = studentPayload.data.find((item: { id: string }) => item.id === sessionId);
    expect(studentItem.zoomJoinUrl).toBe(JOIN_URL);
    expect(studentItem.zoomHostUrl).toBeUndefined();

    asActor(fx.guardianUserId);
    const guardianList = await listSessionsRoute(new Request("http://localhost:3000/api/sessions"));
    const guardianPayload = await guardianList.json();
    const guardianItem = guardianPayload.data.find((item: { id: string }) => item.id === sessionId);
    expect(guardianItem.zoomJoinUrl).toBe(JOIN_URL);
    expect(guardianItem.zoomHostUrl).toBeUndefined();

    asActor(fx.studentUserIds.student1);
    const studentJoin = await joinRoute(new Request(`http://localhost:3000/api/sessions/${sessionId}/join`), routeParams(sessionId));
    expect(studentJoin.status).toBe(307);
    expect(studentJoin.headers.get("location")).toBe(JOIN_URL);
    const click = await prisma.sessionJoinClick.findFirst({ where: { sessionId, userId: fx.studentUserIds.student1 } });
    expect(click).not.toBeNull();

    asActor(fx.guardianUserId);
    const guardianJoin = await joinRoute(new Request(`http://localhost:3000/api/sessions/${sessionId}/join`), routeParams(sessionId));
    expect(guardianJoin.status).toBe(307);
    const guardianClick = await prisma.sessionJoinClick.findFirst({ where: { sessionId, userId: fx.guardianUserId } });
    expect(guardianClick).not.toBeNull();

    asActor(fx.studentUserIds.student2);
    const unenrolledJoin = await joinRoute(new Request(`http://localhost:3000/api/sessions/${sessionId}/join`), routeParams(sessionId));
    expect(unenrolledJoin.status).toBe(404);

    await prisma.session.update({ where: { id: sessionId }, data: { status: "CANCELLED" } });
    asActor(fx.studentUserIds.student1);
    const cancelledJoin = await joinRoute(new Request(`http://localhost:3000/api/sessions/${sessionId}/join`), routeParams(sessionId));
    expect(cancelledJoin.status).toBe(404);

    const insecureSession = await prisma.session.create({
      data: {
        academyId: fx.academyId,
        teacherId: fx.teacherProfileId,
        subjectId: fx.subjectId,
        sessionType: "PRIVATE",
        scheduledStart: futureDate(4, 9),
        scheduledEnd: futureDate(4, 10),
        durationMinutes: 60,
        timezone: "Africa/Cairo",
        zoomJoinUrl: "http://zoom.us/j/123456789",
        createdById: fx.adminUserId,
        status: "SCHEDULED",
        students: { create: [{ studentId: fx.studentProfileIds.student1 }] },
      },
      select: { id: true },
    });
    asActor(fx.studentUserIds.student1);
    const insecureJoin = await joinRoute(new Request(`http://localhost:3000/api/sessions/${insecureSession.id}/join`), routeParams(insecureSession.id));
    expect(insecureJoin.status).toBe(409);
    const insecurePayload = await insecureJoin.json();
    expect(insecurePayload.error?.code).toBe("INVALID_ZOOM_URL");
  });

  it("scenario 12: session status transitions follow the allowlist", async () => {
    await grantCredit(fx.studentProfileIds.student2, 4);
    const { body } = await createSession(fx.adminUserId, {}, { day: 4, hour: 16 });
    const sessionId = body.data.id as string;
    asActor(fx.adminUserId);

    const completed = await updateSessionRoute(
      apiRequest(`/api/sessions/${sessionId}`, "PATCH", { status: "COMPLETED" }),
      routeParams(sessionId),
    );
    expect(completed.status).toBe(400);

    const missed = await updateSessionRoute(
      apiRequest(`/api/sessions/${sessionId}`, "PATCH", { status: "MISSED" }),
      routeParams(sessionId),
    );
    expect(missed.status).toBe(400);

    await prisma.session.update({ where: { id: sessionId }, data: { status: "CANCELLED", cancelledById: fx.adminUserId } });
    const reopen = await updateSessionRoute(
      apiRequest(`/api/sessions/${sessionId}`, "PATCH", { status: "SCHEDULED" }),
      routeParams(sessionId),
    );
    expect(reopen.status).toBe(409);

    const completedSession = await prisma.session.create({
      data: {
        academyId: fx.academyId,
        teacherId: fx.teacherProfileId,
        subjectId: fx.subjectId,
        sessionType: "PRIVATE",
        scheduledStart: futureDate(2, 9),
        scheduledEnd: futureDate(2, 10),
        durationMinutes: 60,
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/completed",
        createdById: fx.adminUserId,
        status: "COMPLETED",
        students: { create: [{ studentId: fx.studentProfileIds.student2 }] },
      },
      select: { id: true },
    });
    const cancelCompleted = await updateSessionRoute(
      apiRequest(`/api/sessions/${completedSession.id}`, "PATCH", { status: "CANCELLED" }),
      routeParams(completedSession.id),
    );
    expect(cancelCompleted.status).toBe(409);
  });

  it("regression R10: zoom links must be https", async () => {
    asActor(fx.adminUserId);
    const httpJoin = await createSessionRoute(
      apiRequest("/api/sessions", "POST", sessionPayload({ zoomJoinUrl: "http://zoom.us/j/123456789", studentIds: [fx.studentProfileIds.student3] })),
    );
    expect(httpJoin.status).toBe(400);
    const payload = await httpJoin.json();
    expect(payload.error?.code).toBe("INVALID_ZOOM_URL");
  });

  it("regression R21: rescheduling moves pending reminder jobs by the same delta", async () => {
    await grantCredit(fx.studentProfileIds.student3, 4);
    const originalStart = futureDateTime(5, 10);
    const { body } = await createSession(fx.adminUserId, {
      studentIds: [fx.studentProfileIds.student3],
    }, { day: 5, hour: 10 });
    const sessionId = body.data.id as string;
    const newStart = new Date(originalStart.getTime() + 3 * 24 * 3600 * 1000);
    const newEnd = new Date(originalStart.getTime() + 3 * 24 * 3600 * 1000 + 3600 * 1000);
    asActor(fx.adminUserId);
    const response = await updateSessionRoute(
      apiRequest(`/api/sessions/${sessionId}`, "PATCH", { scheduledStart: newStart.toISOString(), scheduledEnd: newEnd.toISOString() }),
      routeParams(sessionId),
    );
    expect(response.status).toBe(200);
    const jobs = await prisma.notificationJob.findMany({ where: { sessionId, kind: "SESSION_REMINDER" }, select: { scheduledFor: true } });
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.scheduledFor.getTime()).toBe(newStart.getTime() - 2 * 3600 * 1000);
    }
  });

  it("regression: consumption order prefers the earliest-expiring subscription", async () => {
    await grantCredit(fx.studentProfileIds.student4, 1, "PAY_PER_SESSION");
    const expiring = await prisma.subscription.create({
      data: {
        academyId: fx.academyId,
        studentId: fx.studentProfileIds.student4,
        packageType: "MONTHLY_PLAN",
        sessionsPurchased: 2,
        totalAmountMinor: BigInt(100000),
        currency: "EGP",
        status: "ACTIVE",
        periodStartsAt: new Date(Date.now() - 24 * 3600 * 1000),
        periodEndsAt: new Date(Date.now() + 8 * 24 * 3600 * 1000),
      },
      select: { id: true },
    });
    await prisma.subscriptionLedger.create({
      data: { academyId: fx.academyId, subscriptionId: expiring.id, entryType: "INITIAL_PURCHASE", sessionsDelta: 2 },
    });
    const { body } = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student4] }, { day: 6, hour: 10 });
    expect(body.data.id).toBeTruthy();
    const reservation = await prisma.sessionReservation.findFirstOrThrow({
      where: { sessionId: body.data.id as string },
      select: { subscriptionId: true },
    });
    expect(reservation.subscriptionId).toBe(expiring.id);
  });

  it("regression R6/R16: cancelled sessions free credits and the guardian sees only the join link", async () => {
    await grantCredit(fx.studentProfileIds.student5, 2);
    const { body } = await createSession(fx.adminUserId, {}, { day: 6, hour: 12 });
    const sessionId = body.data.id as string;
    asActor(fx.adminUserId);
    await updateSessionRoute(
      apiRequest(`/api/sessions/${sessionId}`, "PATCH", { status: "CANCELLED" }),
      routeParams(sessionId),
    );
    const activeReservations = await prisma.sessionReservation.count({
      where: { studentId: fx.studentProfileIds.student5, status: "RESERVED" },
    });
    expect(activeReservations).toBe(0);
    asActor(fx.guardianUserId);
    const guardianList = await listSessionsRoute(new Request("http://localhost:3000/api/sessions"));
    const guardianPayload = await guardianList.json();
    const guardianItem = guardianPayload.data.find((item: { id: string }) => item.id === sessionId);
    expect(guardianItem.zoomJoinUrl).toBe(JOIN_URL);
    expect(guardianItem.zoomHostUrl).toBeUndefined();
  });

  it("regression R27: change requests never mutate the session and require a scheduled target", async () => {
    await grantCredit(fx.studentProfileIds.student6, 2);
    const { body } = await createSession(fx.adminUserId, {}, { day: 6, hour: 14 });
    const sessionId = body.data.id as string;
    await prisma.session.update({ where: { id: sessionId }, data: { status: "CANCELLED" } });
    asActor(fx.teacherUserId);
    const rejected = await changeRequestRoute(
      apiRequest(`/api/sessions/${sessionId}/change-request`, "POST", { reason: "outage", proposedChange: "replace" }),
      routeParams(sessionId),
    );
    expect(rejected.status).toBe(409);
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId }, select: { status: true } });
    expect(session.status).toBe("CANCELLED");
  });

  it("regression R9: weekly generation preserves the local wall clock across DST", () => {
    const beforeSpring = new Date("2026-03-06T17:00:00.000Z");
    expect(addWeeksInTimeZone(beforeSpring, 1, "America/New_York").toISOString()).toBe("2026-03-13T16:00:00.000Z");
    const beforeAutumn = new Date("2026-10-30T16:00:00.000Z");
    expect(addWeeksInTimeZone(beforeAutumn, 1, "America/New_York").toISOString()).toBe("2026-11-06T17:00:00.000Z");
  });

  it("regression: recurrences reject duplicated students and private series need exactly one", async () => {
    asActor(fx.adminUserId);
    const duplicate = await recurrencesRoute(
      apiRequest("/api/sessions/recurrences", "POST", sessionPayload({
        weekCount: 2,
        studentIds: [fx.studentProfileIds.student7, fx.studentProfileIds.student7],
      })),
    );
    expect(duplicate.status).toBe(400);
    const multiPrivate = await recurrencesRoute(
      apiRequest("/api/sessions/recurrences", "POST", sessionPayload({
        weekCount: 2,
        studentIds: [fx.studentProfileIds.student7, fx.studentProfileIds.student8],
      })),
    );
    expect(multiPrivate.status).toBe(400);
  });

  it("regression: recurrences validate participants against the academy", async () => {
    asActor(fx.adminUserId);
    const foreignTeacherSeries = await recurrencesRoute(
      apiRequest("/api/sessions/recurrences", "POST", sessionPayload({
        weekCount: 1,
        teacherId: fx.foreignTeacherProfileId,
        studentIds: [fx.studentProfileIds.student7],
      })),
    );
    expect(foreignTeacherSeries.status).toBe(409);
  });

  it("regression: reserveCredit flips a released reservation instead of inserting a duplicate", async () => {
    await grantCredit(fx.studentProfileIds.student7, 2);
    const anchor = futureDate(6, 16);
    const session = await prisma.session.create({
      data: {
        academyId: fx.academyId,
        teacherId: fx.teacherProfileId,
        subjectId: fx.subjectId,
        sessionType: "PRIVATE",
        scheduledStart: anchor,
        scheduledEnd: new Date(anchor.getTime() + 3600 * 1000),
        durationMinutes: 60,
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/987654321123",
        createdById: fx.adminUserId,
        status: "SCHEDULED",
        students: { create: [{ studentId: fx.studentProfileIds.student7 }] },
      },
      select: { id: true, scheduledStart: true },
    });
    const reservation = await prisma.sessionReservation.create({
      data: {
        academyId: fx.academyId,
        sessionId: session.id,
        studentId: fx.studentProfileIds.student7,
        subscriptionId: (await prisma.subscription.findFirstOrThrow({ where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student7 }, select: { id: true } })).id,
        status: "RELEASED",
        releasedAt: new Date(),
      },
      select: { id: true },
    });
    const result = await prisma.$transaction(async (tx) =>
      reserveCredit(tx, fx.academyId, fx.studentProfileIds.student7, session.id, session.scheduledStart),
    );
    expect(result).toBe(true);
    const rows = await prisma.sessionReservation.findMany({
      where: { sessionId: session.id, studentId: fx.studentProfileIds.student7 },
      select: { id: true, status: true, releasedAt: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(reservation.id);
    expect(rows[0].status).toBe("RESERVED");
    expect(rows[0].releasedAt).toBeNull();
  });

  it("returns TEACHER_SUBJECT_NOT_ASSIGNED when the teacher is not linked to the subject", async () => {
    const { status, body } = await createSession(fx.adminUserId, { subjectId: fx.subjectBId }, { day: 8, hour: 10 });
    expect(status).toBe(409);
    expect(body.error?.code).toBe("TEACHER_SUBJECT_NOT_ASSIGNED");
  });

  it("returns STUDENT_NOT_FOUND_OR_INACTIVE with the offending ids", async () => {
    const unknownId = "00000000-0000-4000-8000-000000000000";
    const { status, body } = await createSession(fx.adminUserId, { studentIds: [unknownId] }, { day: 8, hour: 12 });
    expect(status).toBe(409);
    expect(body.error?.code).toBe("STUDENT_NOT_FOUND_OR_INACTIVE");
    expect(body.error?.studentIds).toEqual([unknownId]);

    await prisma.user.update({ where: { id: fx.studentUserIds.student12 }, data: { isActive: false } });
    const inactive = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student12] }, { day: 8, hour: 14 });
    expect(inactive.status).toBe(409);
    expect(inactive.body.error?.code).toBe("STUDENT_NOT_FOUND_OR_INACTIVE");
    expect(inactive.body.error?.studentIds).toEqual([fx.studentProfileIds.student12]);
  });

  it("returns STUDENT_NOT_ASSIGNED_TO_TEACHER_SUBJECT with the offending ids", async () => {
    const { status, body } = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student10] }, { day: 8, hour: 16 });
    expect(status).toBe(409);
    expect(body.error?.code).toBe("STUDENT_NOT_ASSIGNED_TO_TEACHER_SUBJECT");
    expect(body.error?.studentIds).toEqual([fx.studentProfileIds.student10]);
  });

  it("allows an Admin/Supervisor assignment override only with a reason and logs it on the session", async () => {
    await grantCredit(fx.studentProfileIds.student10, 4);
    const withoutReason = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student10] }, { day: 9, hour: 10 });
    expect(withoutReason.status).toBe(409);
    expect(withoutReason.body.error?.code).toBe("STUDENT_NOT_ASSIGNED_TO_TEACHER_SUBJECT");

    const { status, body } = await createSession(
      fx.adminUserId,
      { studentIds: [fx.studentProfileIds.student10], assignmentOverrideReason: "Emergency coverage approved by admin" },
      { day: 9, hour: 10 },
    );
    expect(status).toBe(201);
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: body.data.id },
      select: { assignmentOverriddenById: true, assignmentOverrideReason: true },
    });
    expect(session.assignmentOverriddenById).toBe(fx.adminUserId);
    expect(session.assignmentOverrideReason).toBe("Emergency coverage approved by admin");

    const asSupervisor = await createSession(
      fx.supervisorUserId,
      { studentIds: [fx.studentProfileIds.student10], assignmentOverrideReason: "Supervisor-approved swap" },
      { day: 9, hour: 14 },
    );
    expect(asSupervisor.status).toBe(201);
  });

  it("blocks teacher time conflicts and allows boundary touch, cancelled and missed sessions", async () => {
    // Day 12: the scenario-3 series anchors at now+2h and its week 1 lands on day+7 at the
    // anchor hour, so day-7 slots collide with it whenever the suite runs between 08:00 and
    // 09:59 UTC. The series pauses after two weeks and can never reach day 12.
    await grantCredit(fx.studentProfileIds.student6, 8);
    const { status: firstStatus } = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student6] }, { day: 12, hour: 10 });
    expect(firstStatus).toBe(201);

    const exact = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student6] }, { day: 12, hour: 10 });
    expect(exact.status).toBe(409);
    expect(exact.body.error?.code).toBe("TEACHER_TIME_CONFLICT");

    const partial = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student6] }, { day: 12, hour: 10, minutes: 30 });
    expect(partial.status).toBe(409);
    expect(partial.body.error?.code).toBe("TEACHER_TIME_CONFLICT");

    const boundary = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student6] }, { day: 12, hour: 11 });
    expect(boundary.status).toBe(201);

    // Standalone safety: student9 normally has credit from scenario 9, but a filtered
    // single-test run skips it; an extra grant keeps the test self-sufficient.
    await grantCredit(fx.studentProfileIds.student9, 2);
    const differentTeacher = await createSession(
      fx.adminUserId,
      { teacherId: fx.teacher2ProfileId, studentIds: [fx.studentProfileIds.student9] },
      { day: 12, hour: 10 },
    );
    expect(differentTeacher.status).toBe(201);

    const cancellable = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student6] }, { day: 12, hour: 14 });
    expect(cancellable.status).toBe(201);
    asActor(fx.adminUserId);
    await updateSessionRoute(
      apiRequest(`/api/sessions/${cancellable.body.data.id}`, "PATCH", { status: "CANCELLED", cancellationReason: "test" }),
      routeParams(cancellable.body.data.id as string),
    );
    const afterCancel = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student6] }, { day: 12, hour: 14 });
    expect(afterCancel.status).toBe(201);

    const missable = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student6] }, { day: 12, hour: 16 });
    await prisma.session.update({ where: { id: missable.body.data.id as string }, data: { status: "MISSED" } });
    const afterMiss = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student6] }, { day: 12, hour: 16 });
    expect(afterMiss.status).toBe(201);
  });

  it("rejects sessions starting in the past for creation", async () => {
    const pastStart = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const pastEnd = new Date(Date.now() - 23 * 3600 * 1000).toISOString();
    const { status, body } = await createSession(fx.adminUserId, {
      scheduledStart: pastStart,
      scheduledEnd: pastEnd,
      studentIds: [fx.studentProfileIds.student6],
    }, { day: 3, hour: 10 });
    expect(status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("rejects non-conforming Zoom links on create and update with INVALID_ZOOM_URL", async () => {
    const evil = await createSession(fx.adminUserId, {
      zoomJoinUrl: "https://zoom.us.evil.com/j/123456789",
      studentIds: [fx.studentProfileIds.student6],
    }, { day: 3, hour: 10 });
    expect(evil.status).toBe(400);
    expect(evil.body.error?.code).toBe("INVALID_ZOOM_URL");

    const shortId = await createSession(fx.adminUserId, {
      zoomJoinUrl: "https://zoom.us/j/12345",
      studentIds: [fx.studentProfileIds.student6],
    }, { day: 3, hour: 10 });
    expect(shortId.status).toBe(400);
    expect(shortId.body.error?.code).toBe("INVALID_ZOOM_URL");

    const personal = await createSession(fx.adminUserId, {
      zoomJoinUrl: "https://zoom.us/my/rooms-name",
      studentIds: [fx.studentProfileIds.student6],
    }, { day: 3, hour: 10 });
    expect(personal.status).toBe(400);
    expect(personal.body.error?.code).toBe("INVALID_ZOOM_URL");

    await grantCredit(fx.studentProfileIds.student6, 2);
    const { body } = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student6] }, { day: 8, hour: 18 });
    const sessionId = body.data.id as string;
    asActor(fx.adminUserId);
    const badPatch = await updateSessionRoute(
      apiRequest(`/api/sessions/${sessionId}`, "PATCH", { zoomJoinUrl: "https://user:pass@zoom.us/j/123456789" }),
      routeParams(sessionId),
    );
    expect(badPatch.status).toBe(400);
    expect((await badPatch.json()).error?.code).toBe("INVALID_ZOOM_URL");
  });

  it("pauses a series with an admin notification when a week conflicts with the teacher's schedule", async () => {
    await grantCredit(fx.studentProfileIds.student6, 4);
    const busy = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student6] }, { day: 10, hour: 10 });
    expect(busy.status).toBe(201);

    const anchor = futureDateTime(10, 10, 30);
    const response = await recurrencesRoute(
      apiRequest("/api/sessions/recurrences", "POST", sessionPayload({
        scheduledStart: anchor.toISOString(),
        scheduledEnd: new Date(anchor.getTime() + 3600 * 1000).toISOString(),
        studentIds: [fx.studentProfileIds.student6],
        weekCount: 3,
      })),
    );
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.data.sessions).toHaveLength(0);
    expect(payload.data.paused).toBe(true);
    const series = await prisma.recurrenceSeries.findUniqueOrThrow({ where: { id: payload.data.seriesId } });
    expect(series.status).toBe("PAUSED");
    expect(series.generatedThroughWeek).toBe(-1);
    const flags = await prisma.notificationJob.findMany({
      where: { academyId: fx.academyId, kind: "SERIES_PAUSED", recipientUserId: fx.adminUserId },
    });
    expect(flags.length).toBeGreaterThanOrEqual(1);
  });

  it("hardened enrollment: assignment required, credit reserved, release on removal", async () => {
    await grantCredit(fx.studentProfileIds.student10, 2);
    const { body: sessionBody } = await createSession(fx.adminUserId, { studentIds: [fx.studentProfileIds.student6] }, { day: 11, hour: 10 });
    const sessionId = sessionBody.data.id as string;

    asActor(fx.adminUserId);
    const enrollRequest = (body: unknown) => apiRequest("/api/admin/enrollments", "POST", body);

    const noAssignment = await enrollRoute(enrollRequest({ sessionId, studentId: fx.studentProfileIds.student10 }));
    expect(noAssignment.status).toBe(409);
    expect((await noAssignment.json()).error?.code).toBe("STUDENT_NOT_ASSIGNED_TO_TEACHER_SUBJECT");

    const override = await enrollRoute(
      enrollRequest({ sessionId, studentId: fx.studentProfileIds.student10, assignmentOverrideReason: "Admin add-on to an existing group" }),
    );
    expect(override.status).toBe(201);
    const reservation = await prisma.sessionReservation.findFirstOrThrow({
      where: { sessionId, studentId: fx.studentProfileIds.student10 },
      select: { status: true },
    });
    expect(reservation.status).toBe("RESERVED");

    const removed = await unenrollRoute(
      apiRequest("/api/admin/enrollments", "DELETE", { sessionId, studentId: fx.studentProfileIds.student10 }),
    );
    expect(removed.status).toBe(200);
    const reservationAfter = await prisma.sessionReservation.findFirstOrThrow({
      where: { sessionId, studentId: fx.studentProfileIds.student10 },
      select: { status: true },
    });
    expect(reservationAfter.status).toBe("RELEASED");

    const duplicate = await enrollRoute(enrollRequest({ sessionId, studentId: fx.studentProfileIds.student6 }));
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error?.code).toBe("CONFLICT");

    const noCredit = await enrollRoute(
      enrollRequest({ sessionId, studentId: fx.studentProfileIds.student11, assignmentOverrideReason: "Emergency add" }),
    );
    expect(noCredit.status).toBe(409);
    const noCreditPayload = await noCredit.json();
    expect(noCreditPayload.error?.code).toBe("INSUFFICIENT_SESSION_CREDIT");
    expect(noCreditPayload.error?.studentIds).toEqual([fx.studentProfileIds.student11]);

    await prisma.session.update({ where: { id: sessionId }, data: { status: "CANCELLED" } });
    const cancelled = await enrollRoute(enrollRequest({ sessionId, studentId: fx.studentProfileIds.student7 }));
    expect(cancelled.status).toBe(409);
    expect((await cancelled.json()).error?.code).toBe("SESSION_NOT_SCHEDULED");
  });
});
