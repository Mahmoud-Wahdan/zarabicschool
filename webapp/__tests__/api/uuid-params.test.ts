jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * M-1 (second review, owner 2026-10-27): the 8 [id] routes that reached the
 * database with an unchecked id now answer the shared 400 "Invalid identifier."
 * before any lookup, like every other [id] route. Per-run test academy only.
 */
jest.setTimeout(120_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;

type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

const ROUTES: { name: string; method: string; load: () => Promise<Handler> }[] = [
  { name: "admin/assignments/[id]", method: "PATCH", load: async () => (await import("../../app/api/admin/assignments/[id]/route")).PATCH as Handler },
  { name: "applications/[id]/reject", method: "POST", load: async () => (await import("../../app/api/applications/[id]/reject/route")).POST as Handler },
  { name: "session-change-requests/[id]", method: "PATCH", load: async () => (await import("../../app/api/session-change-requests/[id]/route")).PATCH as Handler },
  { name: "sessions/[id]/change-request", method: "POST", load: async () => (await import("../../app/api/sessions/[id]/change-request/route")).POST as Handler },
  { name: "sessions/[id]/link", method: "PATCH", load: async () => (await import("../../app/api/sessions/[id]/link/route")).PATCH as Handler },
  { name: "sessions/[id]/replacement", method: "POST", load: async () => (await import("../../app/api/sessions/[id]/replacement/route")).POST as Handler },
  { name: "sessions/[id]", method: "PATCH", load: async () => (await import("../../app/api/sessions/[id]/route")).PATCH as Handler },
  { name: "sessions/recurrences/[id]/link", method: "PATCH", load: async () => (await import("../../app/api/sessions/recurrences/[id]/link/route")).PATCH as Handler },
];

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

it("UUID-01..08: a malformed id is refused with 400 'Invalid identifier.' on every listed route", async () => {
  const wrong: string[] = [];
  for (const route of ROUTES) {
    const handler = await route.load();
    for (const actorId of [fx.adminUserId, fx.teacherUserId]) {
      getServerSessionMock.mockResolvedValue({ user: { id: actorId } });
      const response = await handler(
        new Request(`http://localhost:3000/api/${route.name}`, {
          method: route.method,
          headers: sameOriginHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({}),
        }),
        { params: Promise.resolve({ id: "not-a-uuid" }) },
      );
      const body = await response.json().catch(() => ({}));
      const allowedByRole = response.status !== 403;
      if (allowedByRole && (response.status !== 400 || body?.error?.message !== "Invalid identifier.")) {
        wrong.push(`${route.method} ${route.name} as ${actorId === fx.adminUserId ? "admin" : "teacher"} → ${response.status} ${body?.error?.code ?? ""}`);
      }
    }
  }
  expect(wrong).toEqual([]);
});
