jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { prisma } from "../../lib/prisma";
import { resetRateLimits } from "../../lib/rate-limit";
import { isLinkAuditReady } from "../../lib/scheduling/link-audit";
import { GET as joinRoute } from "../../app/api/sessions/[id]/join/route";
import { PATCH as linkRoute } from "../../app/api/sessions/[id]/link/route";
import { PATCH as updateSessionRoute } from "../../app/api/sessions/[id]/route";
import { PATCH as seriesLinkRoute } from "../../app/api/sessions/recurrences/[id]/link/route";
import { POST as recurrencesRoute } from "../../app/api/sessions/recurrences/route";
import { processDueNotificationJobs } from "../../lib/worker/notifications";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

const getServerSessionMock = getServerSession as jest.Mock;

jest.setTimeout(180_000);

const JOIN_URL = "https://zoom.us/j/123456789012";
const HOST_URL = "https://zoom.us/s/987654321012";
const JOIN_URL_B = "https://zoom.us/j/555444333222";
const SERIES_URL_A = "https://zoom.us/j/777000111222";
const SERIES_URL_B = "https://zoom.us/j/777000111333";
const OVERLAP_URL = "https://zoom.us/j/888999000111";

const PENDING_MIGRATION_WARNING =
  "[phase4-test] PENDING MIGRATION 20261012000000_phase4_link_audit — audit assertions are inactive until the owner applies it (npx prisma migrate deploy from webapp/).";

let fx: SessionFixtures;
let auditReady = false;
let otherGuardianUserId = "";
let matrixSession: { id: string };

function asActor(userId: string | null) {
  getServerSessionMock.mockResolvedValue(userId ? { user: { id: userId } } : null);
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function joinRequest(sessionId: string, host = false) {
  return new Request(`http://localhost:3000/api/sessions/${sessionId}/join${host ? "?host=1" : ""}`, {
    method: "GET",
  });
}

function jsonRequest(path: string, method: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createDirectSession(options: {
  startMinutes: number;
  endMinutes: number;
  zoomJoinUrl?: string;
  zoomHostUrl?: string | null;
  studentProfileIds?: string[];
  teacherProfileId?: string;
  status?: "SCHEDULED" | "CANCELLED" | "COMPLETED" | "MISSED";
  recurrenceGroupId?: string | null;
}) {
  const now = Date.now();
  return prisma.session.create({
    data: {
      academyId: fx.academyId,
      teacherId: options.teacherProfileId ?? fx.teacherProfileId,
      subjectId: fx.subjectId,
      sessionType: "PRIVATE",
      scheduledStart: new Date(now + options.startMinutes * 60_000),
      scheduledEnd: new Date(now + options.endMinutes * 60_000),
      durationMinutes: Math.max(1, options.endMinutes - options.startMinutes),
      timezone: "Africa/Cairo",
      zoomJoinUrl: options.zoomJoinUrl ?? JOIN_URL,
      zoomHostUrl: options.zoomHostUrl ?? null,
      status: options.status ?? "SCHEDULED",
      recurrenceGroupId: options.recurrenceGroupId ?? null,
      createdById: fx.adminUserId,
      students: options.studentProfileIds
        ? { create: options.studentProfileIds.map((studentId) => ({ studentId })) }
        : undefined,
    },
    select: { id: true },
  });
}

async function grantCredit(studentProfileId: string, sessionsDelta: number) {
  const subscription = await prisma.subscription.create({
    data: {
      academyId: fx.academyId,
      studentId: studentProfileId,
      packageType: "MONTHLY_PLAN",
      sessionsPurchased: sessionsDelta,
      totalAmountMinor: BigInt(100000),
      currency: "EGP",
      status: "ACTIVE",
      periodStartsAt: new Date(Date.now() - 24 * 3600 * 1000),
      periodEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
    select: { id: true },
  });
  await prisma.subscriptionLedger.create({
    data: {
      academyId: fx.academyId,
      subscriptionId: subscription.id,
      entryType: "INITIAL_PURCHASE",
      sessionsDelta,
    },
  });
}

beforeAll(async () => {
  process.env.MESSAGING_PROVIDER = "fake";
  fx = await createSessionFixtures();
  resetRateLimits();
  auditReady = await isLinkAuditReady();

  // A second guardian whose own child is NOT enrolled in any test session:
  // used for the "guardian without a child in the session" redirect case.
  const guardian2User = await prisma.user.create({
    data: {
      academyId: fx.academyId,
      username: `demo_test_guardian2_${fx.suffix}`,
      displayName: "Demo Test guardian2",
      passwordHash: "test-only",
      role: "GUARDIAN",
      timezone: "Africa/Cairo",
      isActive: true,
      mustChangePassword: false,
      phone: "+201000000021",
    },
    select: { id: true },
  });
  const guardian2 = await prisma.guardian.create({
    data: { userId: guardian2User.id, academyId: fx.academyId, relationship: "FATHER" },
    select: { id: true },
  });
  otherGuardianUserId = guardian2User.id;
  const student13User = await prisma.user.create({
    data: {
      academyId: fx.academyId,
      username: `demo_test_student13_${fx.suffix}`,
      displayName: "Demo Test student13",
      passwordHash: "test-only",
      role: "STUDENT",
      timezone: "Africa/Cairo",
      isActive: true,
      mustChangePassword: false,
      phone: "+201000000022",
    },
    select: { id: true },
  });
  await prisma.student.create({
    data: {
      userId: student13User.id,
      academyId: fx.academyId,
      guardianId: guardian2.id,
      isAdult: false,
      enrollmentDate: new Date(),
    },
  });

  matrixSession = await createDirectSession({
    startMinutes: -5,
    endMinutes: 55,
    zoomJoinUrl: JOIN_URL,
    zoomHostUrl: HOST_URL,
    studentProfileIds: [fx.studentProfileIds.student1, fx.studentProfileIds.student3],
  });
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Phase 4 — join redirect authorization matrix", () => {
  it("the assigned teacher joins through the redirect and is click-logged", async () => {
    asActor(fx.teacherUserId);
    const response = await joinRoute(joinRequest(matrixSession.id), routeParams(matrixSession.id));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(JOIN_URL);
    const clicks = await prisma.sessionJoinClick.findMany({
      where: { sessionId: matrixSession.id, userId: fx.teacherUserId },
    });
    expect(clicks).toHaveLength(1);
  });

  it("another teacher of the same academy gets 404 (no existence leak)", async () => {
    asActor(fx.teacher2UserId);
    const response = await joinRoute(joinRequest(matrixSession.id), routeParams(matrixSession.id));
    expect(response.status).toBe(404);
  });

  it("a guardian whose children are not in the session gets 404", async () => {
    asActor(otherGuardianUserId);
    const response = await joinRoute(joinRequest(matrixSession.id), routeParams(matrixSession.id));
    expect(response.status).toBe(404);
  });

  it("Admin and Supervisor can join any session of their academy", async () => {
    asActor(fx.adminUserId);
    const adminResponse = await joinRoute(joinRequest(matrixSession.id), routeParams(matrixSession.id));
    expect(adminResponse.status).toBe(307);
    asActor(fx.supervisorUserId);
    const supervisorResponse = await joinRoute(joinRequest(matrixSession.id), routeParams(matrixSession.id));
    expect(supervisorResponse.status).toBe(307);
  });

  it("anonymous requests are rejected with 401", async () => {
    asActor(null);
    const response = await joinRoute(joinRequest(matrixSession.id), routeParams(matrixSession.id));
    expect(response.status).toBe(401);
  });

  it("a student of another academy gets 404", async () => {
    asActor(fx.foreignStudentUserId);
    const response = await joinRoute(joinRequest(matrixSession.id), routeParams(matrixSession.id));
    expect(response.status).toBe(404);
  });
});

describe("Phase 4 — join time window (T-15 minutes → scheduled end)", () => {
  it("an enrolled student can join inside the window", async () => {
    asActor(fx.studentUserIds.student1);
    const response = await joinRoute(joinRequest(matrixSession.id), routeParams(matrixSession.id));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(JOIN_URL);
  });

  it("rejects the join before the window opens with JOIN_NOT_YET_OPEN", async () => {
    const session = await createDirectSession({
      startMinutes: 120,
      endMinutes: 180,
      studentProfileIds: [fx.studentProfileIds.student2],
    });
    asActor(fx.studentUserIds.student2);
    const response = await joinRoute(joinRequest(session.id), routeParams(session.id));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("JOIN_NOT_YET_OPEN");
  });

  it("the window opens 15 minutes before the scheduled start", async () => {
    const before = await createDirectSession({
      startMinutes: 16,
      endMinutes: 76,
      studentProfileIds: [fx.studentProfileIds.student2],
    });
    const inside = await createDirectSession({
      startMinutes: 14,
      endMinutes: 74,
      studentProfileIds: [fx.studentProfileIds.student2],
    });
    asActor(fx.studentUserIds.student2);
    const beforeResponse = await joinRoute(joinRequest(before.id), routeParams(before.id));
    expect(beforeResponse.status).toBe(403);
    const insideResponse = await joinRoute(joinRequest(inside.id), routeParams(inside.id));
    expect(insideResponse.status).toBe(307);
  });

  it("rejects the join after the scheduled end with JOIN_WINDOW_CLOSED", async () => {
    const session = await createDirectSession({
      startMinutes: -200,
      endMinutes: -140,
      studentProfileIds: [fx.studentProfileIds.student2],
    });
    asActor(fx.studentUserIds.student2);
    const response = await joinRoute(joinRequest(session.id), routeParams(session.id));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("JOIN_WINDOW_CLOSED");
  });

  it("Admin and Supervisor are exempt from the window", async () => {
    const future = await createDirectSession({ startMinutes: 300, endMinutes: 360 });
    const past = await createDirectSession({ startMinutes: -300, endMinutes: -240 });
    asActor(fx.adminUserId);
    const adminResponse = await joinRoute(joinRequest(future.id), routeParams(future.id));
    expect(adminResponse.status).toBe(307);
    asActor(fx.supervisorUserId);
    const supervisorResponse = await joinRoute(joinRequest(past.id), routeParams(past.id));
    expect(supervisorResponse.status).toBe(307);
  });
});

describe("Phase 4 — click evidence (no URL, never blocking)", () => {
  it("stores one row per click with session/user/time only", async () => {
    const session = await createDirectSession({
      startMinutes: -5,
      endMinutes: 55,
      studentProfileIds: [fx.studentProfileIds.student6],
    });
    asActor(fx.studentUserIds.student6);
    await joinRoute(joinRequest(session.id), routeParams(session.id));
    await joinRoute(joinRequest(session.id), routeParams(session.id));
    const clicks = await prisma.sessionJoinClick.findMany({
      where: { sessionId: session.id, userId: fx.studentUserIds.student6 },
      orderBy: { clickedAt: "asc" },
    });
    expect(clicks).toHaveLength(2);
    for (const click of clicks) {
      expect(Object.keys(click).sort()).toEqual(["clickedAt", "id", "sessionId", "userId"]);
      expect(JSON.stringify(click)).not.toContain("zoom.us");
    }
  });

  it("a failed click insert does not block the redirect and never leaks the link", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const createSpy = jest
      .spyOn(prisma.sessionJoinClick, "create")
      .mockRejectedValueOnce(new Error("click insert failed"));
    try {
      asActor(fx.studentUserIds.student3);
      const response = await joinRoute(joinRequest(matrixSession.id), routeParams(matrixSession.id));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(JOIN_URL);
      expect(createSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
      expect(logged).not.toContain("zoom.us");
    } finally {
      createSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("rate-limits the join redirect at 30 requests per user per minute", async () => {
    resetRateLimits();
    const session = await createDirectSession({
      startMinutes: -5,
      endMinutes: 55,
      studentProfileIds: [fx.studentProfileIds.student5],
    });
    asActor(fx.studentUserIds.student5);
    for (let index = 0; index < 30; index += 1) {
      const response = await joinRoute(joinRequest(session.id), routeParams(session.id));
      expect(response.status).toBe(307);
    }
    const blocked = await joinRoute(joinRequest(session.id), routeParams(session.id));
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    resetRateLimits();
  });
});

describe("Phase 4 — invalid stored links at the redirect", () => {
  it("rejects javascript: and overlong stored links with 409 and never echoes them", async () => {
    const jsSession = await createDirectSession({
      startMinutes: -5,
      endMinutes: 55,
      zoomJoinUrl: "javascript:alert(1)",
      studentProfileIds: [fx.studentProfileIds.student4],
    });
    const longSession = await createDirectSession({
      startMinutes: -5,
      endMinutes: 55,
      zoomJoinUrl: `https://zoom.us/j/${"9".repeat(1983)}`,
      studentProfileIds: [fx.studentProfileIds.student4],
    });
    asActor(fx.studentUserIds.student4);
    const jsResponse = await joinRoute(joinRequest(jsSession.id), routeParams(jsSession.id));
    expect(jsResponse.status).toBe(409);
    const jsBody = await jsResponse.json();
    expect(jsBody.error.code).toBe("INVALID_ZOOM_URL");
    expect(JSON.stringify(jsBody)).not.toContain("javascript:");
    const longResponse = await joinRoute(joinRequest(longSession.id), routeParams(longSession.id));
    expect(longResponse.status).toBe(409);
    const longBody = await longResponse.json();
    expect(longBody.error.code).toBe("INVALID_ZOOM_URL");
    expect(JSON.stringify(longBody)).not.toContain("9".repeat(20));
  });
});

describe("Phase 4 — host-link join variant (?host=1)", () => {
  it("the assigned teacher starts the meeting via the host link", async () => {
    asActor(fx.teacherUserId);
    const response = await joinRoute(joinRequest(matrixSession.id, true), routeParams(matrixSession.id));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(HOST_URL);
    const clicks = await prisma.sessionJoinClick.findMany({
      where: { sessionId: matrixSession.id, userId: fx.teacherUserId },
    });
    expect(clicks.length).toBeGreaterThanOrEqual(2);
  });

  it("students and guardians get 404 for the host variant (no existence leak)", async () => {
    asActor(fx.studentUserIds.student1);
    const studentResponse = await joinRoute(joinRequest(matrixSession.id, true), routeParams(matrixSession.id));
    expect(studentResponse.status).toBe(404);
    asActor(fx.guardianUserId);
    const guardianResponse = await joinRoute(joinRequest(matrixSession.id, true), routeParams(matrixSession.id));
    expect(guardianResponse.status).toBe(404);
  });

  it("an unassigned teacher gets 404 for the host variant", async () => {
    asActor(fx.teacher2UserId);
    const response = await joinRoute(joinRequest(matrixSession.id, true), routeParams(matrixSession.id));
    expect(response.status).toBe(404);
  });

  it("Admin can use the host variant", async () => {
    asActor(fx.adminUserId);
    const response = await joinRoute(joinRequest(matrixSession.id, true), routeParams(matrixSession.id));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(HOST_URL);
  });

  it("404 NO_HOST_LINK when no host link is stored", async () => {
    const session = await createDirectSession({ startMinutes: -5, endMinutes: 55 });
    asActor(fx.teacherUserId);
    const response = await joinRoute(joinRequest(session.id, true), routeParams(session.id));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NO_HOST_LINK");
  });
});

describe("Phase 4 — per-session link editing (PATCH /api/sessions/:id/link)", () => {
  it("teachers and students cannot edit links", async () => {
    const session = await createDirectSession({ startMinutes: 100, endMinutes: 160 });
    asActor(fx.teacherUserId);
    const teacherResponse = await linkRoute(
      jsonRequest(`/api/sessions/${session.id}/link`, "PATCH", { zoomJoinUrl: JOIN_URL_B }),
      routeParams(session.id),
    );
    expect(teacherResponse.status).toBe(403);
    asActor(fx.studentUserIds.student1);
    const studentResponse = await linkRoute(
      jsonRequest(`/api/sessions/${session.id}/link`, "PATCH", { zoomJoinUrl: JOIN_URL_B }),
      routeParams(session.id),
    );
    expect(studentResponse.status).toBe(403);
  });

  it("Admin updates both links, Supervisor updates too, and the host link can be cleared", async () => {
    const session = await createDirectSession({
      startMinutes: 100,
      endMinutes: 160,
      zoomJoinUrl: JOIN_URL,
      zoomHostUrl: HOST_URL,
    });
    asActor(fx.adminUserId);
    const adminResponse = await linkRoute(
      jsonRequest(`/api/sessions/${session.id}/link`, "PATCH", { zoomJoinUrl: JOIN_URL_B, zoomHostUrl: "" }),
      routeParams(session.id),
    );
    expect(adminResponse.status).toBe(200);
    const adminBody = await adminResponse.json();
    expect(adminBody.data.joinUrlChanged).toBe(true);
    expect(adminBody.data.hostUrlChanged).toBe(true);
    expect(adminBody.data.warnings).toEqual([]);
    const afterAdmin = await prisma.session.findUnique({
      where: { id: session.id },
      select: { zoomJoinUrl: true, zoomHostUrl: true },
    });
    expect(afterAdmin?.zoomJoinUrl).toBe(JOIN_URL_B);
    expect(afterAdmin?.zoomHostUrl).toBeNull();

    asActor(fx.supervisorUserId);
    const supervisorResponse = await linkRoute(
      jsonRequest(`/api/sessions/${session.id}/link`, "PATCH", { zoomJoinUrl: JOIN_URL_B, zoomHostUrl: HOST_URL }),
      routeParams(session.id),
    );
    expect(supervisorResponse.status).toBe(200);
    const afterSupervisor = await prisma.session.findUnique({
      where: { id: session.id },
      select: { zoomHostUrl: true },
    });
    expect(afterSupervisor?.zoomHostUrl).toBe(HOST_URL);
  });

  it("rejects invalid links with 400 INVALID_ZOOM_URL and never echoes the submitted value", async () => {
    const session = await createDirectSession({ startMinutes: 100, endMinutes: 160 });
    asActor(fx.adminUserId);
    const badLinks = [
      "http://zoom.us/j/123456789012",
      "javascript:alert(1)",
      "https://evil.com/j/123456789012",
      `https://zoom.us/j/${"9".repeat(1982)}`,
    ];
    for (const badLink of badLinks) {
      const response = await linkRoute(
        jsonRequest(`/api/sessions/${session.id}/link`, "PATCH", { zoomJoinUrl: badLink }),
        routeParams(session.id),
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_ZOOM_URL");
      expect(JSON.stringify(body)).not.toContain(badLink.slice(0, 30));
    }
    const unchanged = await prisma.session.findUnique({
      where: { id: session.id },
      select: { zoomJoinUrl: true },
    });
    expect(unchanged?.zoomJoinUrl).toBe(JOIN_URL);
  });

  it("409 SESSION_NOT_SCHEDULED for a cancelled session and 404 for an unknown session", async () => {
    const cancelled = await createDirectSession({
      startMinutes: -300,
      endMinutes: -240,
      status: "CANCELLED",
    });
    asActor(fx.adminUserId);
    const cancelledResponse = await linkRoute(
      jsonRequest(`/api/sessions/${cancelled.id}/link`, "PATCH", { zoomJoinUrl: JOIN_URL_B }),
      routeParams(cancelled.id),
    );
    expect(cancelledResponse.status).toBe(409);
    const cancelledBody = await cancelledResponse.json();
    expect(cancelledBody.error.code).toBe("SESSION_NOT_SCHEDULED");
    const unknownResponse = await linkRoute(
      jsonRequest("/api/sessions/00000000-0000-4000-8000-000000000000/link", "PATCH", { zoomJoinUrl: JOIN_URL_B }),
      routeParams("00000000-0000-4000-8000-000000000000"),
    );
    expect(unknownResponse.status).toBe(404);
  });

  it("writes one audit row per link change without the URL value (requires migration 20261012000000_phase4_link_audit)", async () => {
    const session = await createDirectSession({
      startMinutes: 200,
      endMinutes: 260,
      zoomJoinUrl: JOIN_URL,
      zoomHostUrl: HOST_URL,
    });
    asActor(fx.supervisorUserId);
    const response = await linkRoute(
      jsonRequest(`/api/sessions/${session.id}/link`, "PATCH", { zoomJoinUrl: JOIN_URL_B, zoomHostUrl: "" }),
      routeParams(session.id),
    );
    expect(response.status).toBe(200);
    if (!auditReady) {
      console.warn(PENDING_MIGRATION_WARNING);
      return;
    }
    const rows = await prisma.sessionLinkAudit.findMany({ where: { sessionId: session.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("SESSION");
    expect(rows[0].changedById).toBe(fx.supervisorUserId);
    expect(rows[0].joinUrlChanged).toBe(true);
    expect(rows[0].hostUrlChanged).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain("zoom.us");
  });

  it("the general session PATCH audits link changes too (requires migration 20261012000000_phase4_link_audit)", async () => {
    const session = await createDirectSession({ startMinutes: 150, endMinutes: 210, zoomJoinUrl: JOIN_URL });
    asActor(fx.adminUserId);
    const response = await updateSessionRoute(
      jsonRequest(`/api/sessions/${session.id}`, "PATCH", { zoomJoinUrl: JOIN_URL_B }),
      routeParams(session.id),
    );
    expect(response.status).toBe(200);
    const after = await prisma.session.findUnique({
      where: { id: session.id },
      select: { zoomJoinUrl: true },
    });
    expect(after?.zoomJoinUrl).toBe(JOIN_URL_B);
    if (!auditReady) {
      console.warn(PENDING_MIGRATION_WARNING);
      return;
    }
    const rows = await prisma.sessionLinkAudit.findMany({ where: { sessionId: session.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("SESSION");
    expect(rows[0].joinUrlChanged).toBe(true);
    expect(rows[0].hostUrlChanged).toBe(false);
    expect(JSON.stringify(rows[0])).not.toContain("zoom.us");
  });
});

describe("Phase 4 — series apply-link-to-upcoming (PATCH /api/sessions/recurrences/:id/link)", () => {
  it("updates only future non-cancelled sessions and the recurrence rule", async () => {
    await grantCredit(fx.studentProfileIds.student1, 4);
    const start = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    start.setUTCHours(11, 0, 0, 0);
    asActor(fx.adminUserId);
    const createResponse = await recurrencesRoute(
      jsonRequest("/api/sessions/recurrences", "POST", {
        teacherId: fx.teacherProfileId,
        subjectId: fx.subjectId,
        sessionType: "PRIVATE",
        scheduledStart: start.toISOString(),
        scheduledEnd: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
        timezone: "Africa/Cairo",
        zoomJoinUrl: SERIES_URL_A,
        studentIds: [fx.studentProfileIds.student1],
        weekCount: 2,
      }),
    );
    expect(createResponse.ok).toBe(true);
    const series = await prisma.recurrenceSeries.findFirst({
      where: { academyId: fx.academyId },
      orderBy: { createdAt: "desc" },
      select: { id: true, recurrenceRule: true },
    });
    expect(series).not.toBeNull();

    const pastSession = await createDirectSession({
      startMinutes: -200,
      endMinutes: -140,
      zoomJoinUrl: SERIES_URL_A,
      recurrenceGroupId: series!.id,
      studentProfileIds: [fx.studentProfileIds.student1],
    });
    const cancelledFuture = await createDirectSession({
      startMinutes: 2000,
      endMinutes: 2060,
      zoomJoinUrl: SERIES_URL_A,
      recurrenceGroupId: series!.id,
      status: "CANCELLED",
      studentProfileIds: [fx.studentProfileIds.student1],
    });

    const applyResponse = await seriesLinkRoute(
      jsonRequest(`/api/sessions/recurrences/${series!.id}/link`, "PATCH", {
        zoomJoinUrl: SERIES_URL_B,
        zoomHostUrl: HOST_URL,
      }),
      routeParams(series!.id),
    );
    expect(applyResponse.status).toBe(200);
    const payload = await applyResponse.json();
    expect(payload.data.updatedSessions).toBe(2);
    expect(payload.data.warnings).toEqual([]);

    const seriesSessions = await prisma.session.findMany({
      where: { recurrenceGroupId: series!.id },
      select: { id: true, zoomJoinUrl: true, zoomHostUrl: true, status: true, scheduledStart: true },
    });
    const futureScheduled = seriesSessions.filter(
      (session) => session.status === "SCHEDULED" && session.scheduledStart.getTime() >= Date.now(),
    );
    expect(futureScheduled).toHaveLength(2);
    for (const session of futureScheduled) {
      expect(session.zoomJoinUrl).toBe(SERIES_URL_B);
      expect(session.zoomHostUrl).toBe(HOST_URL);
    }
    const past = seriesSessions.find((session) => session.id === pastSession.id);
    expect(past?.zoomJoinUrl).toBe(SERIES_URL_A);
    const cancelled = seriesSessions.find((session) => session.id === cancelledFuture.id);
    expect(cancelled?.zoomJoinUrl).toBe(SERIES_URL_A);

    const ruleAfter = await prisma.recurrenceSeries.findUnique({
      where: { id: series!.id },
      select: { recurrenceRule: true },
    });
    const rule = ruleAfter!.recurrenceRule as { zoomJoinUrl?: string; zoomHostUrl?: string | null };
    expect(rule.zoomJoinUrl).toBe(SERIES_URL_B);
    expect(rule.zoomHostUrl).toBe(HOST_URL);

    if (!auditReady) {
      console.warn(PENDING_MIGRATION_WARNING);
    } else {
      const auditRows = await prisma.sessionLinkAudit.findMany({ where: { seriesId: series!.id } });
      expect(auditRows).toHaveLength(2);
      for (const row of auditRows) {
        expect(row.source).toBe("SERIES");
        expect(row.sessionId).not.toBeNull();
        expect(JSON.stringify(row)).not.toContain("zoom.us");
      }
    }
  });

  it("teachers cannot apply series links and unknown series get 404", async () => {
    const series = await prisma.recurrenceSeries.findFirst({
      where: { academyId: fx.academyId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    asActor(fx.teacherUserId);
    const teacherResponse = await seriesLinkRoute(
      jsonRequest(`/api/sessions/recurrences/${series!.id}/link`, "PATCH", { zoomJoinUrl: SERIES_URL_B }),
      routeParams(series!.id),
    );
    expect(teacherResponse.status).toBe(403);
    asActor(fx.adminUserId);
    const unknownResponse = await seriesLinkRoute(
      jsonRequest("/api/sessions/recurrences/00000000-0000-4000-8000-000000000000/link", "PATCH", {
        zoomJoinUrl: SERIES_URL_B,
      }),
      routeParams("00000000-0000-4000-8000-000000000000"),
    );
    expect(unknownResponse.status).toBe(404);
  });
});

describe("Phase 4 — same-link overlap warning (warn, never block)", () => {
  it("returns a ZOOM_LINK_OVERLAP warning on save and still saves the link", async () => {
    const other = await createDirectSession({
      startMinutes: 30,
      endMinutes: 90,
      zoomJoinUrl: OVERLAP_URL,
    });
    const target = await createDirectSession({
      startMinutes: 0,
      endMinutes: 60,
      zoomJoinUrl: JOIN_URL,
    });
    asActor(fx.adminUserId);
    const response = await linkRoute(
      jsonRequest(`/api/sessions/${target.id}/link`, "PATCH", { zoomJoinUrl: OVERLAP_URL }),
      routeParams(target.id),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.warnings).toHaveLength(1);
    expect(body.data.warnings[0].code).toBe("ZOOM_LINK_OVERLAP");
    expect(body.data.warnings[0].sessionIds).toContain(other.id);
    const saved = await prisma.session.findUnique({
      where: { id: target.id },
      select: { zoomJoinUrl: true },
    });
    expect(saved?.zoomJoinUrl).toBe(OVERLAP_URL);
  });

  it("no warning when the same link is used at non-overlapping times", async () => {
    const session = await createDirectSession({
      startMinutes: 500,
      endMinutes: 560,
      zoomJoinUrl: JOIN_URL,
    });
    asActor(fx.adminUserId);
    const response = await linkRoute(
      jsonRequest(`/api/sessions/${session.id}/link`, "PATCH", { zoomJoinUrl: OVERLAP_URL }),
      routeParams(session.id),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.warnings).toEqual([]);
  });
});

describe("Phase 4 — links never leak into logs or job errors", () => {
  it("a failing provider stores a lastError without the join link", async () => {
    const job = await prisma.notificationJob.create({
      data: {
        academyId: fx.academyId,
        sessionId: matrixSession.id,
        recipientUserId: fx.teacherUserId,
        kind: "SESSION_START",
        dedupKey: `phase4-leak-${fx.suffix}`,
        scheduledFor: new Date(Date.now() - 60_000),
        status: "PENDING",
      },
    });
    const previousProvider = process.env.MESSAGING_PROVIDER;
    process.env.MESSAGING_PROVIDER = "openwa";
    try {
      await processDueNotificationJobs(new Date(), fx.academyId);
    } finally {
      process.env.MESSAGING_PROVIDER = previousProvider ?? "fake";
    }
    const failed = await prisma.notificationJob.findUnique({ where: { id: job.id } });
    expect(failed?.status).toBe("FAILED");
    expect(JSON.stringify(failed?.lastError ?? "")).not.toContain("zoom.us");
  });
});
