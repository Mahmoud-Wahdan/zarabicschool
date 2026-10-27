jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getServerSession } from "next-auth";

import { GET as joinRoute } from "../../app/api/sessions/[id]/join/route";
import { prisma } from "../../lib/prisma";
import { resetRateLimits } from "../../lib/rate-limit";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * M-2 reversed / D45 (owner, 2026-10-27; replaces D32): the teacher always gets the
 * JOIN link (dashboard button and WhatsApp). The host link is for the Supervisor and
 * the Admin only, through `?host=1`; a teacher, student or guardian asking for it gets
 * the same 404 as an unknown session. Plain URLs give everyone the join link.
 * Per-run test academy only.
 */
jest.setTimeout(180_000);

const MINUTE = 60_000;
const JOIN_URL = "https://zoom.us/j/123456789012";
const HOST_URL = "https://zoom.us/s/987654321012";
const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

async function createSession(zoomHostUrl: string | null) {
  const now = Date.now();
  return prisma.session.create({
    data: {
      academyId: fx.academyId,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
      sessionType: "PRIVATE",
      scheduledStart: new Date(now + 5 * MINUTE),
      scheduledEnd: new Date(now + 65 * MINUTE),
      durationMinutes: 60,
      timezone: "Africa/Cairo",
      zoomJoinUrl: JOIN_URL,
      zoomHostUrl,
      status: "SCHEDULED",
      createdById: fx.adminUserId,
      students: { create: [{ studentId: fx.studentProfileIds.student2 }] },
    },
    select: { id: true },
  });
}

async function plainJoin(sessionId: string, userId: string) {
  asActor(userId);
  const response = await joinRoute(
    new Request(`http://localhost:3000/api/sessions/${sessionId}/join`, { method: "GET" }),
    { params: Promise.resolve({ id: sessionId }) },
  );
  expect(response.status).toBe(307);
  return response.headers.get("location");
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

beforeEach(() => resetRateLimits());

afterAll(async () => {
  await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("M-2 reversed — host link for Admin/Supervisor only (D45)", () => {
  it("HL-01: the assigned teacher gets the join link even when a host link is stored", async () => {
    const session = await createSession(HOST_URL);
    expect(await plainJoin(session.id, fx.teacherUserId)).toBe(JOIN_URL);
  });

  it("HL-07: the teacher asking for the host variant gets the generic 404 (no existence leak)", async () => {
    const session = await createSession(HOST_URL);
    asActor(fx.teacherUserId);
    const response = await joinRoute(
      new Request(`http://localhost:3000/api/sessions/${session.id}/join?host=1`, { method: "GET" }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  it("HL-08: Admin and Supervisor open the host link through the host variant", async () => {
    const session = await createSession(HOST_URL);
    for (const userId of [fx.adminUserId, fx.supervisorUserId]) {
      asActor(userId);
      const response = await joinRoute(
        new Request(`http://localhost:3000/api/sessions/${session.id}/join?host=1`, { method: "GET" }),
        { params: Promise.resolve({ id: session.id }) },
      );
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(HOST_URL);
    }
  });

  it("HL-09 (static): teacher pages no longer tell the teacher about a host link", () => {
    for (const file of ["app/[locale]/teacher/page.tsx", "app/[locale]/teacher/sessions/page.tsx"]) {
      expect(readFileSync(join(process.cwd(), file), "utf8")).not.toMatch(/hostNote|zoomHostUrl/);
    }
  });

  it("HL-02: without a host link the teacher gets the join link (never NO_HOST_LINK)", async () => {
    const session = await createSession(null);
    expect(await plainJoin(session.id, fx.teacherUserId)).toBe(JOIN_URL);
  });

  it("HL-03: students and guardians never get the host link", async () => {
    const session = await createSession(HOST_URL);
    expect(await plainJoin(session.id, fx.studentUserIds.student2)).toBe(JOIN_URL);
    expect(await plainJoin(session.id, fx.guardianUserId)).toBe(JOIN_URL);
  });

  it("HL-04: Admin and Supervisor keep the join link on the plain URL", async () => {
    const session = await createSession(HOST_URL);
    expect(await plainJoin(session.id, fx.adminUserId)).toBe(JOIN_URL);
    expect(await plainJoin(session.id, fx.supervisorUserId)).toBe(JOIN_URL);
  });

  it("HL-06 (static): teacher pages use the plain join link, never `?host=1` (no NO_HOST_LINK dead end)", () => {
    for (const file of ["app/[locale]/teacher/page.tsx", "app/[locale]/teacher/sessions/page.tsx"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const joinLinks = source.match(/<SessionJoinLink\b[^>]*>/g) ?? [];
      expect(joinLinks.length).toBeGreaterThan(0);
      for (const tag of joinLinks) expect(tag).not.toMatch(/\bhost\b/);
    }
  });

  it("HL-05: every teacher click is still logged", async () => {
    const session = await createSession(HOST_URL);
    await plainJoin(session.id, fx.teacherUserId);
    const clicks = await prisma.sessionJoinClick.count({ where: { sessionId: session.id, userId: fx.teacherUserId } });
    expect(clicks).toBe(1);
  });
});
