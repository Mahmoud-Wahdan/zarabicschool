jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

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
 * I-1 (second review, owner 2026-10-27; D4): the join link is opened from WhatsApp
 * in a browser. A signed-out reader goes to the PUBLIC login page and comes back to
 * the session after signing in; a browser never sees a raw JSON error — it is sent
 * to a readable status page. API callers (no text/html Accept) keep the JSON codes.
 * Per-run test academy only.
 */
jest.setTimeout(180_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;
const savedPublicUrl = process.env.APP_PUBLIC_URL;

function asActor(userId: string | null) {
  getServerSessionMock.mockResolvedValue(userId ? { user: { id: userId } } : null);
}

function browserRequest(sessionId: string, cookie?: string) {
  return new Request(`http://internal-host:3000/api/sessions/${sessionId}/join`, {
    method: "GET",
    headers: { accept: "text/html,application/xhtml+xml", ...(cookie ? { cookie } : {}) },
  });
}

async function futureSession(startMinutes: number) {
  const now = Date.now();
  return prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
      scheduledStart: new Date(now + startMinutes * 60_000), scheduledEnd: new Date(now + (startMinutes + 60) * 60_000),
      durationMinutes: 60, timezone: "Africa/Cairo", zoomJoinUrl: "https://zoom.us/j/123456789012", createdById: fx.adminUserId,
      status: "SCHEDULED", students: { create: [{ studentId: fx.studentProfileIds.student2 }] },
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  fx = await createSessionFixtures();
  process.env.APP_PUBLIC_URL = "https://public.example.test";
});

beforeEach(() => resetRateLimits());

afterAll(async () => {
  if (savedPublicUrl === undefined) delete process.env.APP_PUBLIC_URL;
  else process.env.APP_PUBLIC_URL = savedPublicUrl;
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Join link opened in a browser (I-1)", () => {
  it("JL-05: signed out → the PUBLIC login page with a callback to this session (never the internal host)", async () => {
    const session = await futureSession(-5);
    asActor(null);
    const response = await joinRoute(browserRequest(session.id), { params: Promise.resolve({ id: session.id }) });
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://public.example.test");
    expect(location.pathname).toBe("/ar/login");
    expect(location.searchParams.get("callbackUrl")).toBe(`/api/sessions/${session.id}/join`);
  });

  it("JL-06: the signed-out redirect keeps the reader's language cookie", async () => {
    const session = await futureSession(-5);
    asActor(null);
    const response = await joinRoute(browserRequest(session.id, "NEXT_LOCALE=en"), { params: Promise.resolve({ id: session.id }) });
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/en/login");
  });

  it("JL-07: a browser before the window opens is sent to the status page; an API caller still gets the JSON code", async () => {
    const session = await futureSession(180);
    asActor(fx.studentUserIds.student2);
    const browser = await joinRoute(browserRequest(session.id), { params: Promise.resolve({ id: session.id }) });
    expect(browser.status).toBe(307);
    const location = new URL(browser.headers.get("location") ?? "");
    expect(location.origin).toBe("https://public.example.test");
    expect(location.pathname).toBe("/ar/join-status");
    expect(location.searchParams.get("reason")).toBe("JOIN_NOT_YET_OPEN");
    expect(location.toString()).not.toContain("zoom.us");

    const api = await joinRoute(new Request(`http://localhost:3000/api/sessions/${session.id}/join`), { params: Promise.resolve({ id: session.id }) });
    expect(api.status).toBe(403);
    expect((await api.json()).error.code).toBe("JOIN_NOT_YET_OPEN");
  });

  it("JL-08: an unknown or foreign session in a browser → the same status page as 'not found'", async () => {
    asActor(fx.studentUserIds.student2);
    const unknownId = "00000000-0000-4000-8000-000000000000";
    const response = await joinRoute(browserRequest(unknownId), { params: Promise.resolve({ id: unknownId }) });
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("reason")).toBe("NOT_FOUND");
  });
});
