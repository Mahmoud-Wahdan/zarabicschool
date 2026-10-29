import { apiHandlers, SIGNED_WEBHOOKS, type AppRole } from "../support/routes";
import { clientIp, ROLE_HOME, type RoleKey } from "../support/run";
import { call, expect, test } from "../support/test";

/**
 * OWASP A01 (Broken Access Control), over HTTP against the running app — the proxy,
 * the page guards and every API handler, the way a browser or an attacker reaches them.
 * The Jest suite (owasp.test.ts, same-origin-guard.test.ts) calls the handlers
 * directly; this adds the middleware, the production config and the real cookies.
 */
const APP_ROLE: Record<RoleKey, AppRole> = {
  admin: "ADMIN",
  supervisor: "SUPERVISOR",
  teacher: "TEACHER",
  guardian: "GUARDIAN",
  student: "STUDENT",
  adult: "STUDENT",
};

/** Page areas and who may open them (proxy.ts rolesForRoute + the page guards). */
const AREAS: { roles: AppRole[]; paths: string[] }[] = [
  {
    roles: ["ADMIN"],
    paths: [
      "/admin", "/admin/applications", "/admin/reports", "/admin/monthly-reports", "/admin/session-requests",
      "/admin/financials", "/admin/billing", "/admin/invoices", "/admin/renewals", "/admin/payment-audit",
      "/admin/whatsapp", "/admin/payroll", "/admin/overtime", "/admin/performance", "/admin/users",
    ],
  },
  {
    roles: ["ADMIN", "SUPERVISOR"],
    paths: [
      "/admin/students", "/admin/teachers", "/admin/guardians", "/admin/subjects", "/admin/assignments",
      "/admin/enrollments", "/admin/sessions", "/admin/complaints", "/admin/evaluations", "/admin/announcements",
    ],
  },
  { roles: ["SUPERVISOR"], paths: ["/supervisor", "/supervisor/reports", "/supervisor/monthly-reports", "/supervisor/session-requests"] },
  {
    roles: ["TEACHER"],
    paths: ["/teacher", "/teacher/sessions", "/teacher/calendar", "/teacher/monthly-reports", "/teacher/attendance", "/teacher/indicators", "/teacher/payroll"],
  },
  { roles: ["GUARDIAN"], paths: ["/guardian", "/guardian/sessions", "/guardian/reports", "/guardian/invoices", "/guardian/attendance"] },
  { roles: ["STUDENT"], paths: ["/student", "/student/sessions", "/student/reports", "/student/attendance", "/student/calendar"] },
];

test.describe("A01 pages: every role area refuses the other roles and anonymous visitors", () => {
  for (const who of ["anon", "admin", "supervisor", "teacher", "guardian", "student"] as const) {
    test(`${who}: redirected away from areas it may not open`, async ({ api }) => {
      const client = await api(who, { origin: null });
      const target = who === "anon" ? "/en/login" : `/en${ROLE_HOME[who]}`;
      for (const area of AREAS) {
        if (who !== "anon" && area.roles.includes(APP_ROLE[who])) continue;
        for (const path of area.paths) {
          const response = await call(() => client.get(`/en${path}`, { maxRedirects: 0 }));
          expect.soft(response.status(), `${who} → ${path}`).toBe(307);
          expect.soft(new URL(response.headers()["location"] ?? "", "http://x").pathname, `${who} → ${path}`).toBe(target);
        }
      }
    });
  }
});

test.describe("A01 API: anonymous callers get nothing", () => {
  test("every handler answers 401/403 without a session (public and signed routes excepted)", async ({ api }) => {
    const client = await api("anon");
    let checked = 0;
    for (const handler of apiHandlers()) {
      const response = await call(() => client.fetch(handler.url, { method: handler.method, data: handler.method === "GET" ? undefined : {}, maxRedirects: 0 }));
      const label = `${handler.method} ${handler.route}`;
      if (SIGNED_WEBHOOKS.includes(handler.route)) {
        // An empty body is malformed (400) or unsigned (401); a well-formed body with a bad
        // signature is checked in owasp-top10.spec.ts (A08). Never processed either way.
        expect.soft([400, 401], `${label}: unsigned callback answered ${response.status()}`).toContain(response.status());
      } else if (handler.route === "/api/subjects" && handler.method === "GET") {
        expect.soft(response.status(), `${label}: public subject list`).toBe(200);
      } else if (handler.route === "/api/applications" && handler.method === "POST") {
        expect.soft(response.status(), `${label}: public form, empty body`).toBe(400);
      } else if (handler.route === "/api/sessions/[id]/join") {
        // Browser-friendly join link (I-1): anonymous → the login page with a return path.
        expect.soft(response.status(), label).toBe(307);
        expect.soft(response.headers()["location"] ?? "", label).toMatch(/\/login\?callbackUrl=%2Fapi%2Fsessions%2F/);
      } else {
        expect.soft([401, 403], `${label}: answered ${response.status()}`).toContain(response.status());
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });
});

test.describe("A01/A02 API: cross-site requests are refused before anything else (CSRF)", () => {
  for (const [label, origin] of [["a foreign Origin", "https://evil.example"], ["no Origin", null]] as const) {
    test(`every state-changing handler refuses ${label} even for a signed-in Admin`, async ({ api }) => {
      const client = await api("admin", { origin, ip: clientIp(`csrf-${label}`) });
      for (const handler of apiHandlers()) {
        if (handler.method === "GET" || SIGNED_WEBHOOKS.includes(handler.route)) continue;
        const response = await call(() => client.fetch(handler.url, { method: handler.method, data: {} }));
        expect.soft(response.status(), `${handler.method} ${handler.route}`).toBe(403);
        const body = await response.json().catch(() => null);
        expect.soft(body?.error?.code, `${handler.method} ${handler.route}`).toBe("ORIGIN_NOT_ALLOWED");
      }
    });
  }
});

test.describe("A01 API: the role matrix comes from each handler's own guard", () => {
  for (const who of ["admin", "supervisor", "teacher", "guardian", "student"] as const) {
    test(`${who}: 403 on every handler that does not list ${APP_ROLE[who]}`, async ({ api }) => {
      const client = await api(who);
      let refused = 0;
      for (const handler of apiHandlers()) {
        if (!handler.roles || handler.roles.includes(APP_ROLE[who])) continue;
        const response = await call(() => client.fetch(handler.url, { method: handler.method, data: handler.method === "GET" ? undefined : {} }));
        expect.soft(response.status(), `${who}: ${handler.method} ${handler.route}`).toBe(403);
        refused++;
      }
      expect(refused).toBeGreaterThan(0);
    });
  }
});
