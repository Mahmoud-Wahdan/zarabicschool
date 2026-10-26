jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { getServerSession } from "next-auth";

import nextConfig from "../../next.config";
import { GET as subjectsRoute } from "../../app/api/subjects/route";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * OWASP Top 10:2025 automated checks (Phase 8; mapping in docs/specs/security-review.md).
 * The route lists are DERIVED from the code (each handler's own requireApiRoles call),
 * so a new route is covered automatically. Per-run test academy only.
 */
jest.setTimeout(600_000);

const getServerSessionMock = getServerSession as jest.Mock;
const API_ROOT = path.join(process.cwd(), "app", "api");
const ROLES = ["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"] as const;
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;
// Public by design: NextAuth, the two signed webhooks, the public application form
// and its subject list (scoped to one academy since 2026-10-26).
const PUBLIC = new Set(["auth/[...nextauth]/route.ts", "payments/paymob/webhook/route.ts", "whatsapp/status/route.ts", "applications/route.ts POST", "subjects/route.ts GET"]);
const ANY_ID = "00000000-0000-4000-8000-000000000000";
let fx: SessionFixtures;

function walk(dir: string, match: (file: string) => boolean): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full, match) : match(full) ? [full] : [];
  });
}

type Handler = { file: string; relative: string; method: (typeof METHODS)[number]; roles: string[] | null };

/** Every exported handler with the roles ITS OWN body requires (null = no role guard). */
const handlers: Handler[] = walk(API_ROOT, (file) => file.endsWith("route.ts")).flatMap((file) => {
  const source = readFileSync(file, "utf8");
  const relative = path.relative(API_ROOT, file).split(path.sep).join("/");
  return METHODS.flatMap((method) => {
    const start = source.search(new RegExp(`export\\s+async\\s+function\\s+${method}\\b`));
    if (start < 0) return [];
    const rest = source.slice(start + 10);
    const next = rest.search(/export\s+async\s+function\s+/);
    const body = next < 0 ? rest : rest.slice(0, next);
    const many = body.match(/requireApiRoles\(\s*\[([^\]]*)\]/);
    const one = body.match(/requireApiRole\(\s*"([A-Z]+)"/);
    const roles = many ? [...many[1].matchAll(/"([A-Z]+)"/g)].map((m) => m[1]) : one ? [one[1]] : null;
    return [{ file, relative, method, roles }];
  });
});

function request(method: string) {
  return new Request("http://localhost:3000/api/owasp-sweep", {
    method,
    headers: sameOriginHeaders({ "content-type": "application/json" }),
    body: method === "GET" ? undefined : "{}",
  });
}

async function call(handler: Handler) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(handler.file) as Record<string, (request: Request, context: unknown) => Promise<Response>>;
  const context = { params: Promise.resolve(new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : ANY_ID) })) };
  return mod[handler.method](request(handler.method), context);
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("A01 Broken Access Control", () => {
  it("OW-A01-0: the sweep found the routes, and every non-public handler has a role guard", () => {
    expect(handlers.length).toBeGreaterThan(60);
    const unguarded = handlers.filter((h) => h.roles === null && !PUBLIC.has(h.relative) && !PUBLIC.has(`${h.relative} ${h.method}`));
    // change-password checks the session itself (getAuthSession) — any signed-in role.
    expect(unguarded.map((h) => `${h.method} ${h.relative}`)).toEqual(["POST auth/change-password/route.ts"]);
  });

  it("OW-A01-1: without a session every protected handler refuses (401, or the login redirect for the join link) — never 2xx", async () => {
    getServerSessionMock.mockResolvedValue(null);
    const failures: string[] = [];
    for (const handler of handlers.filter((h) => h.roles !== null || h.relative === "auth/change-password/route.ts")) {
      const response = await call(handler);
      const ok = handler.relative === "sessions/[id]/join/route.ts" ? response.status === 307 : response.status === 401;
      if (!ok) failures.push(`${handler.method} ${handler.relative} → ${response.status}`);
    }
    expect(failures).toEqual([]);
  });

  it("OW-A01-2: every role NOT in a handler's own list gets 403 — incl. Supervisor on every money route — never 2xx", async () => {
    const userFor: Record<string, string> = {
      ADMIN: fx.adminUserId, SUPERVISOR: fx.supervisorUserId, TEACHER: fx.teacherUserId, STUDENT: fx.studentUserIds.student1, GUARDIAN: fx.guardianUserId,
    };
    const failures: string[] = [];
    let checks = 0;
    for (const handler of handlers.filter((h) => h.roles !== null)) {
      for (const role of ROLES.filter((r) => !handler.roles!.includes(r))) {
        getServerSessionMock.mockResolvedValue({ user: { id: userFor[role] } });
        const response = await call(handler);
        checks += 1;
        if (response.status !== 403) failures.push(`${role} ${handler.method} ${handler.relative} → ${response.status}`);
      }
    }
    expect(checks).toBeGreaterThan(100);
    expect(failures).toEqual([]);
  });

  it("OW-A01-4: the subject list never crosses academies (signed-in → own academy; foreign Admin → only theirs)", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: fx.adminUserId } });
    const own = (await (await subjectsRoute()).json()) as { id: string }[];
    expect(own.map((s) => s.id).sort()).toEqual([fx.subjectId, fx.subjectBId].sort());
    getServerSessionMock.mockResolvedValue({ user: { id: fx.foreignAdminUserId } });
    const foreign = (await (await subjectsRoute()).json()) as { id: string }[];
    expect(foreign.map((s) => s.id)).toEqual([fx.foreignSubjectId]);
  });

  it("OW-A01-3: money routes are ADMIN-only (Supervisor never moves or sees money)", () => {
    const money = handlers.filter((h) => /^(payroll|invoices|admin\/billing|admin\/teacher-rates|payments)/.test(h.relative) || /overtime|confirm/.test(h.relative));
    const leaking = money.filter((h) => h.roles?.includes("SUPERVISOR"));
    expect(leaking.map((h) => `${h.method} ${h.relative}`)).toEqual([]);
  });
});

describe("A02 Security Misconfiguration", () => {
  it("OW-A02-1: every path sends nosniff, a strict referrer policy and X-Frame-Options DENY", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((rule) => rule.source === "/:path*");
    const headers = Object.fromEntries((all?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"]).toBe("DENY");
  });
});

describe("A04 Cryptographic Failures", () => {
  it("OW-A04-1: every password hash uses bcrypt cost ≥ 12 (no plaintext, no weak cost)", () => {
    const files = walk(path.join(process.cwd(), "app"), (f) => /\.(ts|tsx)$/.test(f)).concat(walk(path.join(process.cwd(), "lib"), (f) => /\.ts$/.test(f)));
    const costs = files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/bcrypt\.hash\([^,]+,\s*(\d+)\)/g)].map((m) => ({ file, cost: Number(m[1]) })));
    expect(costs.length).toBeGreaterThan(3);
    expect(costs.filter((c) => c.cost < 12)).toEqual([]);
  });

  it("OW-A04-2: both webhook signatures are compared in constant time", () => {
    for (const file of ["lib/payments/paymob.ts", "app/api/whatsapp/status/route.ts"]) {
      expect(readFileSync(path.join(process.cwd(), file), "utf8")).toMatch(/timingSafeEqual\(/);
    }
  });
});

describe("A09 Logging — no secrets or personal data in log statements", () => {
  it("OW-A09-1: no console call interpolates a password, phone, token, secret, key, Zoom link, message body or comment", () => {
    const files = walk(path.join(process.cwd(), "app"), (f) => /\.(ts|tsx)$/.test(f)).concat(walk(path.join(process.cwd(), "lib"), (f) => /\.ts$/.test(f)));
    const sensitive = /\$\{[^}]*\b(password|tempPassword|passwordHash|phone|token|secret|apiKey|hmac|zoomJoinUrl|zoomHostUrl|checkoutUrl|body|comment|message|text)\b[^}]*\}/i;
    // Reviewed and allowed: SeriesRuleError messages are fixed text naming a FIELD only
    // ("recurrence rule has an invalid \"scheduledStart\""), never a value.
    const allowed = ["lib/worker/notifications.ts:SeriesRuleError"];
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        const key = `${path.relative(process.cwd(), file).split(path.sep).join("/")}:${line.includes("SeriesRuleError") || line.includes("malformed rule") ? "SeriesRuleError" : index + 1}`;
        if (/console\.(log|info|warn|error|debug)\(/.test(line) && sensitive.test(line) && !allowed.includes(key)) {
          offenders.push(`${path.relative(process.cwd(), file)}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("A10 Mishandling of Exceptional Conditions", () => {
  it("OW-A10-1: error responses carry a code and a message only — no stack trace, no SQL/Prisma details", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: fx.adminUserId } });
    const samples = handlers.filter((h) => h.roles?.includes("ADMIN") && h.method !== "GET").slice(0, 25);
    for (const handler of samples) {
      const response = await call(handler);
      if (response.status < 400) continue;
      const text = await response.text();
      expect(text).not.toMatch(/\n\s+at |prisma|PrismaClient|SELECT |INSERT |node_modules/i);
    }
  });
});
