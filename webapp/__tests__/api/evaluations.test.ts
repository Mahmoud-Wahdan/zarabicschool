jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { POST as evaluateRoute } from "../../app/api/sessions/[id]/evaluations/route";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Session evaluations (backlog EV-01..07; Session 3 rules): optional, by the student
 * or the guardian, one per (session, author), editable for 24 h, only after the
 * session ended and never for a cancelled/missed one. Per-run test academy only.
 */
jest.setTimeout(180_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;

async function evaluate(actorId: string, sessionId: string, body: Record<string, unknown>) {
  getServerSessionMock.mockResolvedValue({ user: { id: actorId } });
  const response = await evaluateRoute(
    new Request(`http://localhost:3000/api/sessions/${sessionId}/evaluations`, {
      method: "POST",
      headers: sameOriginHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function session(studentKeys: string[], options: { endedMinutesAgo?: number; status?: "COMPLETED" | "SCHEDULED" | "CANCELLED" | "MISSED" } = {}) {
  const end = new Date(Date.now() - (options.endedMinutesAgo ?? 30) * 60 * 1000);
  return prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId,
      sessionType: studentKeys.length > 1 ? "GROUP" : "PRIVATE",
      scheduledStart: new Date(end.getTime() - 60 * 60 * 1000), scheduledEnd: end, durationMinutes: 60,
      timezone: "Africa/Cairo", zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId,
      status: options.status ?? "COMPLETED",
      students: { create: studentKeys.map((key) => ({ studentId: fx.studentProfileIds[key] })) },
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

describe("Session evaluations", () => {
  it("EV-01: a roster student evaluates once (201); a second submit within 24 h updates the same row (200)", async () => {
    const s = await session(["student1"]);
    const first = await evaluate(fx.studentUserIds.student1, s.id, { rating: 4, comment: "Good" });
    expect(first.status).toBe(201);
    const second = await evaluate(fx.studentUserIds.student1, s.id, { rating: 5, comment: "Better" });
    expect(second.status).toBe(200);
    const rows = await prisma.sessionEvaluation.findMany({ where: { sessionId: s.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rating: 5, comment: "Better", authorType: "STUDENT" });
  });

  it("EV-02: a guardian with TWO children on the same group session has exactly ONE evaluation", async () => {
    const s = await session(["student2", "student3"]);
    expect((await evaluate(fx.guardianUserId, s.id, { rating: 3 })).status).toBe(201);
    expect((await evaluate(fx.guardianUserId, s.id, { rating: 4 })).status).toBe(200);
    expect(await prisma.sessionEvaluation.count({ where: { sessionId: s.id, authorUserId: fx.guardianUserId } })).toBe(1);
  });

  it("EV-03: a student who is not on the roster gets the generic 404 (no existence leak)", async () => {
    const s = await session(["student4"]);
    const result = await evaluate(fx.studentUserIds.student5, s.id, { rating: 5 });
    expect(result.status).toBe(404);
    expect(await prisma.sessionEvaluation.count({ where: { sessionId: s.id } })).toBe(0);
  });

  it("EV-04: rating must be an integer 1–5 and the comment at most 2000 chars; Arabic/emoji text is stored intact", async () => {
    const s = await session(["student6"]);
    for (const rating of [0, 6, 2.5, "5"]) {
      expect((await evaluate(fx.studentUserIds.student6, s.id, { rating })).status).toBe(400);
    }
    expect((await evaluate(fx.studentUserIds.student6, s.id, { rating: 3, comment: "x".repeat(2001) })).status).toBe(400);
    const arabic = "ممتاز جداً — بارك الله فيكم 🌙 <script>alert(1)</script>";
    expect((await evaluate(fx.studentUserIds.student6, s.id, { rating: 5, comment: arabic })).status).toBe(201);
    expect((await prisma.sessionEvaluation.findFirstOrThrow({ where: { sessionId: s.id } })).comment).toBe(arabic);
  });

  it("EV-05: after 24 h the evaluation is locked (403 EVALUATION_LOCKED) and unchanged", async () => {
    const s = await session(["student7"]);
    await evaluate(fx.studentUserIds.student7, s.id, { rating: 2 });
    await prisma.sessionEvaluation.updateMany({ where: { sessionId: s.id }, data: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });
    const late = await evaluate(fx.studentUserIds.student7, s.id, { rating: 5 });
    expect(late.status).toBe(403);
    expect(late.body.error.code).toBe("EVALUATION_LOCKED");
    expect((await prisma.sessionEvaluation.findFirstOrThrow({ where: { sessionId: s.id } })).rating).toBe(2);
  });

  it("EV-06: two concurrent first submits create ONE row and no server error", async () => {
    const s = await session(["student8"]);
    const results = await Promise.all([
      evaluate(fx.studentUserIds.student8, s.id, { rating: 4 }),
      evaluate(fx.studentUserIds.student8, s.id, { rating: 4 }),
    ]);
    expect(results.every((result) => result.status === 200 || result.status === 201)).toBe(true);
    expect(await prisma.sessionEvaluation.count({ where: { sessionId: s.id } })).toBe(1);
  });

  it("EV-07: a cancelled, missed or not-yet-ended session cannot be evaluated (409)", async () => {
    const cancelled = await session(["student9"], { status: "CANCELLED" });
    const missed = await session(["student9"], { status: "MISSED" });
    const future = await session(["student9"], { endedMinutesAgo: -120, status: "SCHEDULED" });
    for (const s of [cancelled, missed, future]) {
      const result = await evaluate(fx.studentUserIds.student9, s.id, { rating: 3 });
      expect(result.status).toBe(409);
      expect(result.body.error.code).toBe("SESSION_NOT_EVALUABLE");
    }
  });
});
