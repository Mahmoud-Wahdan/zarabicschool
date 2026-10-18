jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { prisma } from "../../lib/prisma";
import { resetRateLimits } from "../../lib/rate-limit";
import { isSessionRequestsReady } from "../../lib/scheduling/session-requests";
import { POST as createSessionRoute } from "../../app/api/sessions/route";
import { POST as sessionRequestRoute } from "../../app/api/sessions/[id]/session-request/route";
import { POST as reviewSessionRequestRoute } from "../../app/api/session-requests/[id]/review/route";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

const getServerSessionMock = getServerSession as jest.Mock;

jest.setTimeout(180_000);

let fx: SessionFixtures;
let requestsReady = false;

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

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const JOIN_URL = "https://zoom.us/j/987654321098";

let slotCounter = 0;

async function createSessionViaApi(actorId: string, studentProfileId: string) {
  asActor(actorId);
  slotCounter += 1;
  const start = new Date(Date.now() + (24 + slotCounter * 3) * 3600 * 1000);
  start.setUTCMinutes(0, 0, 0);
  const response = await createSessionRoute(
    apiRequest("/api/sessions", "POST", {
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
      sessionType: "PRIVATE",
      scheduledStart: start.toISOString(),
      scheduledEnd: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      timezone: "Africa/Cairo",
      zoomJoinUrl: JOIN_URL,
      studentIds: [studentProfileId],
    }),
  );
  const payload = await response.json();
  if (response.status !== 201) {
    throw new Error(`Session creation failed: ${JSON.stringify(payload)}`);
  }
  return payload.data as { id: string; scheduledStart: string };
}

async function grantCredit(studentProfileId: string, sessionsDelta: number) {
  const subscription = await prisma.subscription.create({
    data: {
      academyId: fx.academyId,
      studentId: studentProfileId,
      packageType: "MONTHLY_PLAN",
      sessionsPurchased: Math.max(sessionsDelta, 0),
      totalAmountMinor: BigInt(100000),
      currency: "EGP",
      status: "ACTIVE",
      periodStartsAt: new Date(Date.now() - 24 * 3600 * 1000),
      periodEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
    select: { id: true },
  });
  if (sessionsDelta !== 0) {
    await prisma.subscriptionLedger.create({
      data: { academyId: fx.academyId, subscriptionId: subscription.id, entryType: "INITIAL_PURCHASE", sessionsDelta },
    });
  }
}

async function submitRequest(sessionId: string, actorId: string, reason = "Internet outage at home.") {
  asActor(actorId);
  const response = await sessionRequestRoute(
    apiRequest(`/api/sessions/${sessionId}/session-request`, "POST", { reason }),
    routeParams(sessionId),
  );
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function reviewRequest(id: string, actorId: string, body: Record<string, unknown>) {
  asActor(actorId);
  const response = await reviewSessionRequestRoute(apiRequest(`/api/session-requests/${id}/review`, "POST", body), routeParams(id));
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function replacementBody(session: { scheduledStart: string }, overrides: Record<string, unknown> = {}) {
  const start = new Date(new Date(session.scheduledStart).getTime() + 7 * 24 * 3600 * 1000);
  return {
    teacherId: fx.teacherProfileId,
    subjectId: fx.subjectId,
    sessionType: "PRIVATE",
    scheduledStart: start.toISOString(),
    scheduledEnd: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    timezone: "Africa/Cairo",
    zoomJoinUrl: JOIN_URL,
    studentIds: [],
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.MESSAGING_PROVIDER = "fake";
  fx = await createSessionFixtures();
  requestsReady = await isSessionRequestsReady();
  if (!requestsReady) {
    console.warn(
      "[phase5-test] PENDING MIGRATION — session_requests not applied yet (migration phase5_session_requests). The outage-request suite asserts migration-pending behavior and activates fully once the owner applies the migration.",
    );
  }
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Phase 5 Batch C — outage/absence requests (database-backed)", () => {
  it("answers the migration-pending conflict until the owner applies the session_requests migration", async () => {
    await grantCredit(fx.studentProfileIds.student1, 2);
    const session = await createSessionViaApi(fx.adminUserId, fx.studentProfileIds.student1);
    const submitted = await submitRequest(session.id, fx.studentUserIds.student1);
    if (!requestsReady) {
      expect(submitted.status).toBe(409);
      expect(submitted.body.error.code).toBe("SESSION_REQUESTS_MIGRATION_PENDING");
      return;
    }
    expect(submitted.status).toBe(201);
  });

  if (true) {
    it("accepts student, guardian and assigned-teacher requests and notifies Admin+Supervisor", async () => {
      if (!requestsReady) {
        console.warn("[phase5-test] PENDING MIGRATION — skipping the full outage-request matrix.");
        return;
      }
      resetRateLimits();
      await grantCredit(fx.studentProfileIds.student2, 2);
      const session = await createSessionViaApi(fx.adminUserId, fx.studentProfileIds.student2);

      const studentRequest = await submitRequest(session.id, fx.studentUserIds.student2);
      expect(studentRequest.status).toBe(201);
      const operatorJobs = await prisma.notificationJob.findMany({
        where: { kind: "SESSION_REQUEST", dedupKey: { startsWith: `SESSION_REQUEST:${studentRequest.body.data.id}` } },
        select: { recipientUserId: true },
      });
      const operatorIds = operatorJobs.map((job) => job.recipientUserId).sort();
      expect(operatorIds).toEqual([fx.adminUserId, fx.supervisorUserId].sort());

      const guardianRequest = await submitRequest(session.id, fx.guardianUserId, "Child is sick today.");
      expect(guardianRequest.status).toBe(201);

      const teacherRequest = await submitRequest(session.id, fx.teacherUserId, "Power cut in my area.");
      expect(teacherRequest.status).toBe(201);
    });

    it("rejects strangers, missing reasons, duplicate open requests, and cancelled sessions", async () => {
      if (!requestsReady) {
        console.warn("[phase5-test] PENDING MIGRATION — skipping the full outage-request matrix.");
        return;
      }
      resetRateLimits();
      await grantCredit(fx.studentProfileIds.student3, 2);
      const session = await createSessionViaApi(fx.adminUserId, fx.studentProfileIds.student3);

      const stranger = await submitRequest(session.id, fx.studentUserIds.student4);
      expect(stranger.status).toBe(404);
      const otherTeacher = await submitRequest(session.id, fx.teacher2UserId);
      expect(otherTeacher.status).toBe(404);

      asActor(fx.studentUserIds.student3);
      const noReason = await sessionRequestRoute(
        apiRequest(`/api/sessions/${session.id}/session-request`, "POST", {}),
        routeParams(session.id),
      );
      expect(noReason.status).toBe(400);

      const first = await submitRequest(session.id, fx.studentUserIds.student3);
      expect(first.status).toBe(201);
      const duplicate = await submitRequest(session.id, fx.studentUserIds.student3);
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe("ALREADY_REQUESTED");

      // After a rejection the same requester can open a new request.
      const rejected = await reviewRequest(first.body.data.id, fx.adminUserId, { action: "REJECT" });
      expect(rejected.status).toBe(200);
      const again = await submitRequest(session.id, fx.studentUserIds.student3);
      expect(again.status).toBe(201);
    });

    it("lets only Admin/Supervisor review; approve-without-replacement is a 400; double-reject is a no-op", async () => {
      if (!requestsReady) {
        console.warn("[phase5-test] PENDING MIGRATION — skipping the full outage-request matrix.");
        return;
      }
      resetRateLimits();
      await grantCredit(fx.studentProfileIds.student5, 2);
      const session = await createSessionViaApi(fx.adminUserId, fx.studentProfileIds.student5);
      const request = await submitRequest(session.id, fx.studentUserIds.student5);

      const teacherAttempt = await reviewRequest(request.body.data.id, fx.teacherUserId, { action: "REJECT" });
      expect(teacherAttempt.status).toBe(403);

      const missingReplacement = await reviewRequest(request.body.data.id, fx.adminUserId, { action: "APPROVE" });
      expect(missingReplacement.status).toBe(400);

      const rejected = await reviewRequest(request.body.data.id, fx.adminUserId, { action: "REJECT" });
      expect(rejected.status).toBe(200);
      expect(rejected.body.data.status).toBe("REJECTED");
      const repeat = await reviewRequest(request.body.data.id, fx.adminUserId, { action: "REJECT" });
      expect(repeat.status).toBe(200);
      expect(repeat.body.alreadyHandled).toBe(true);
    });

    it("approves a whole-session outage: original becomes MISSED, reservations released, replacement linked with its own jobs", async () => {
      if (!requestsReady) {
        console.warn("[phase5-test] PENDING MIGRATION — skipping the full outage-request matrix.");
        return;
      }
      resetRateLimits();
      await grantCredit(fx.studentProfileIds.student6, 3);
      const session = await createSessionViaApi(fx.adminUserId, fx.studentProfileIds.student6);
      const request = await submitRequest(session.id, fx.studentUserIds.student6, "Teacher had a full outage.");

      const sourceReservation = await prisma.sessionReservation.findUniqueOrThrow({
        where: { sessionId_studentId: { sessionId: session.id, studentId: fx.studentProfileIds.student6 } },
      });
      expect(sourceReservation.status).toBe("RESERVED");

      const approved = await reviewRequest(request.body.data.id, fx.supervisorUserId, {
        action: "APPROVE",
        scope: "SESSION",
        replacement: replacementBody(session, { studentIds: [fx.studentProfileIds.student6] }),
      });
      expect(approved.status).toBe(200);
      expect(approved.body.data.status).toBe("APPROVED");
      expect(approved.body.data.replacementSessionId).not.toBeNull();

      const original = await prisma.session.findUniqueOrThrow({ where: { id: session.id }, select: { status: true, cancellationReason: true } });
      expect(original.status).toBe("MISSED");
      expect(original.cancellationReason).toContain("outage");

      const released = await prisma.sessionReservation.findUniqueOrThrow({
        where: { sessionId_studentId: { sessionId: session.id, studentId: fx.studentProfileIds.student6 } },
      });
      expect(released.status).toBe("RELEASED");

      const replacementId = approved.body.data.replacementSessionId as string;
      const replacement = await prisma.session.findUniqueOrThrow({
        where: { id: replacementId },
        select: { replacementForSessionId: true, students: { select: { studentId: true } } },
      });
      expect(replacement.replacementForSessionId).toBe(session.id);
      expect(replacement.students.map((entry) => entry.studentId)).toEqual([fx.studentProfileIds.student6]);
      const replacementReservation = await prisma.sessionReservation.findUnique({
        where: { sessionId_studentId: { sessionId: replacementId, studentId: fx.studentProfileIds.student6 } },
      });
      expect(replacementReservation?.status).toBe("RESERVED");

      // F-12: the replacement's participants get their reminder/start jobs.
      const replacementJobs = await prisma.notificationJob.findMany({
        where: { sessionId: replacementId, kind: { in: ["SESSION_REMINDER", "SESSION_START"] } },
        select: { kind: true, recipientUserId: true },
      });
      const kinds = new Set(replacementJobs.map((job) => job.kind));
      expect(kinds.has("SESSION_REMINDER")).toBe(true);
      expect(kinds.has("SESSION_START")).toBe(true);
    });

    it("approves a per-student absence in a group: the session stays SCHEDULED and only the requester is replaced", async () => {
      if (!requestsReady) {
        console.warn("[phase5-test] PENDING MIGRATION — skipping the full outage-request matrix.");
        return;
      }
      resetRateLimits();
      await grantCredit(fx.studentProfileIds.student7, 3);
      await grantCredit(fx.studentProfileIds.student8, 3);
      // Group session with both students (roster shared; each keeps their own reservation).
      asActor(fx.adminUserId);
      slotCounter += 1;
      const start = new Date(Date.now() + (30 + slotCounter * 3) * 3600 * 1000);
      start.setUTCMinutes(0, 0, 0);
      const groupResponse = await createSessionRoute(
        apiRequest("/api/sessions", "POST", {
          teacherId: fx.teacherProfileId,
          subjectId: fx.subjectId,
          sessionType: "GROUP",
          scheduledStart: start.toISOString(),
          scheduledEnd: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
          timezone: "Africa/Cairo",
          zoomJoinUrl: JOIN_URL,
          studentIds: [fx.studentProfileIds.student7, fx.studentProfileIds.student8],
        }),
      );
      expect(groupResponse.status).toBe(201);
      const group = (await groupResponse.json()).data as { id: string; scheduledStart: string };
      const request = await submitRequest(group.id, fx.studentUserIds.student7, "I cannot attend this slot.");

      const approved = await reviewRequest(request.body.data.id, fx.adminUserId, {
        action: "APPROVE",
        scope: "STUDENT",
        replacement: replacementBody(group, {
          sessionType: "PRIVATE",
          studentIds: [fx.studentProfileIds.student7],
        }),
      });
      expect(approved.status).toBe(200);

      const original = await prisma.session.findUniqueOrThrow({ where: { id: group.id }, select: { status: true } });
      expect(original.status).toBe("SCHEDULED");

      const released = await prisma.sessionReservation.findUniqueOrThrow({
        where: { sessionId_studentId: { sessionId: group.id, studentId: fx.studentProfileIds.student7 } },
      });
      expect(released.status).toBe("RELEASED");
      const untouched = await prisma.sessionReservation.findUniqueOrThrow({
        where: { sessionId_studentId: { sessionId: group.id, studentId: fx.studentProfileIds.student8 } },
      });
      expect(untouched.status).toBe("RESERVED");

      const replacement = await prisma.session.findUniqueOrThrow({
        where: { id: approved.body.data.replacementSessionId },
        select: { replacementForSessionId: true, sessionType: true, students: { select: { studentId: true } } },
      });
      expect(replacement.replacementForSessionId).toBe(group.id);
      expect(replacement.sessionType).toBe("PRIVATE");
      expect(replacement.students.map((entry) => entry.studentId)).toEqual([fx.studentProfileIds.student7]);
    });

    it("resolves concurrent approvals with exactly one winner", async () => {
      if (!requestsReady) {
        console.warn("[phase5-test] PENDING MIGRATION — skipping the full outage-request matrix.");
        return;
      }
      resetRateLimits();
      await grantCredit(fx.studentProfileIds.student9, 3);
      const session = await createSessionViaApi(fx.adminUserId, fx.studentProfileIds.student9);
      const request = await submitRequest(session.id, fx.studentUserIds.student9);
      const requestId = request.body.data.id;

      const [first, second] = await Promise.all([
        reviewRequest(requestId, fx.adminUserId, { action: "APPROVE", replacement: replacementBody(session, { studentIds: [fx.studentProfileIds.student9] }) }),
        reviewRequest(requestId, fx.supervisorUserId, { action: "REJECT" }),
      ]);
      const statuses = [first.status, second.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);
      const row = await prisma.sessionRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true, replacementSessionId: true } });
      const decided = [row.status === "APPROVED", row.status === "REJECTED"].filter(Boolean);
      expect(decided).toHaveLength(1);
    });
  }
});
