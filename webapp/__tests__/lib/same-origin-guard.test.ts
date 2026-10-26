jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { getServerSession } from "next-auth";

import { disconnectPrisma } from "../../lib/prisma";

/**
 * B3 cross-origin sweep (Phase 8, owner 2026-10-26). Every POST/PATCH/PUT/DELETE
 * handler under app/api must refuse a request whose Origin is missing or foreign
 * with 403 ORIGIN_NOT_ALLOWED — BEFORE any session lookup or database work.
 * Exempt by design: the two signed server-to-server webhooks and NextAuth's own
 * route (it has its own CSRF token).
 */
const API_ROOT = path.join(process.cwd(), "app", "api");
const EXEMPT = [
  path.join("payments", "paymob", "webhook", "route.ts"),
  path.join("whatsapp", "status", "route.ts"),
  path.join("auth", "[...nextauth]", "route.ts"),
];
const MUTATIONS = ["POST", "PATCH", "PUT", "DELETE"] as const;
const ANY_ID = "00000000-0000-4000-8000-000000000000";

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === "route.ts" ? [full] : [];
  });
}

const mutationRoutes = routeFiles(API_ROOT)
  .filter((file) => !EXEMPT.includes(path.relative(API_ROOT, file)))
  .map((file) => {
    const source = readFileSync(file, "utf8");
    const methods = MUTATIONS.filter((method) => new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(source));
    return { file, relative: path.relative(API_ROOT, file).split(path.sep).join("/"), source, methods };
  })
  .filter((route) => route.methods.length > 0);

const sessionMock = getServerSession as jest.Mock;

function request(origin: string | null) {
  return new Request("http://localhost:3000/api/sweep", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: "{}",
  });
}

afterAll(async () => {
  await disconnectPrisma();
});

describe("B3 same-origin guard — every mutation route", () => {
  it("finds the mutation routes (sanity: the sweep is not empty)", () => {
    expect(mutationRoutes.length).toBeGreaterThan(30);
  });

  it.each(mutationRoutes.map((route) => [route.relative, route] as const))("%s calls the same-origin guard", (_name, route) => {
    expect(/requireSameOrigin\(|isSameOrigin\(/.test(route.source)).toBe(true);
  });

  for (const route of mutationRoutes) {
    for (const method of route.methods) {
      it(`${method} ${route.relative} → 403 ORIGIN_NOT_ALLOWED for a missing or foreign Origin, before any session lookup`, async () => {
        sessionMock.mockReset();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const handler = require(route.file)[method] as (request: Request, context: unknown) => Promise<Response>;
        const context = { params: Promise.resolve(new Proxy({}, { get: () => ANY_ID })) };
        for (const origin of [null, "https://evil.example", "http://localhost:3001"]) {
          const response = await handler(request(origin), context);
          expect(response.status).toBe(403);
          const body = await response.json();
          expect(body.error?.code).toBe("ORIGIN_NOT_ALLOWED");
        }
        expect(sessionMock).not.toHaveBeenCalled();
      });
    }
  }
});
