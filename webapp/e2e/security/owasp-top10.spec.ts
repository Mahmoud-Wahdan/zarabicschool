import { spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { query } from "../support/db";
import { BASE_URL, clientIp, run } from "../support/run";
import { call, errorsOf, expect, messages, test, visit, type Who } from "../support/test";

/**
 * OWASP Top 10:2025, dynamically, against the running production build. Mapping and
 * known gaps: docs/specs/security-review.md. Tests that pin a KNOWN, still-open gap
 * are marked test.fail() with the gap id: they pass while the gap is open and turn
 * red once it is fixed, so the marker gets removed with the fix.
 */
const r = () => run();
const json = { "content-type": "application/json" };

async function signIn(open: (who: Who, options?: { ip?: string; javaScriptEnabled?: boolean }) => Promise<import("@playwright/test").Page>, username: string, password: string, ip: string) {
  const page = await open("anon", { ip });
  await visit(page, "/en/login");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Enter the platform" }).click();
  return page;
}

test.describe("A01 Broken Access Control", () => {
  test("a student cannot join, or even see, a session they are not in (IDOR)", async ({ api }) => {
    const student = await api("student");
    const join = await student.get(`/api/sessions/${r().ids.futureSession}/join`, { maxRedirects: 0 });
    expect(join.status()).toBe(404);
    const list = await (await student.get("/api/sessions")).json();
    expect(list.data.some((session: { id: string }) => session.id === r().ids.futureSession)).toBe(false);
    expect(JSON.stringify(list)).not.toContain("zoomHostUrl");
  });

  test("another family's invoice is not readable (IDOR) and a guardian-linked student has no invoice access", async ({ api }) => {
    const guardian = await api("guardian");
    const other = await guardian.get(`/api/invoices/${r().ids.adultInvoice}`);
    expect([403, 404]).toContain(other.status());
    expect(await other.text()).not.toMatch(/amountMinor|80000|studentId/);
    // Same academy, not the payer: 403, while a missing id is 404 (an existence hint only;
    // ids are random UUIDs). Reports answer 404 in both cases. Recorded as G-A01-5 (low).
    test.info().annotations.push({ type: "G-A01-5", description: `other family's invoice: HTTP ${other.status()}` });
    const student = await api("student");
    expect((await student.get(`/api/invoices/${r().ids.familyInvoice}`)).status()).toBe(403);
    expect((await student.get("/api/invoices")).status()).toBe(403);
  });

  test("an Admin cannot read or change another academy's records (tenancy)", async ({ api }) => {
    const admin = await api("admin");
    const foreignTeacher = await admin.get(`/api/admin/teachers/${r().fixtures.foreignStudentProfileId}/context`);
    expect(foreignTeacher.status()).toBe(404);
    const foreignSubject = await admin.patch(`/api/subjects/${r().fixtures.foreignSubjectId}`, { data: { nameEn: "E2E tenancy probe" } });
    expect(foreignSubject.status()).toBe(404);
    const rows = await query<{ name_en: string }>("SELECT name_en FROM subjects WHERE id = $1", [r().fixtures.foreignSubjectId]);
    expect(rows[0].name_en).not.toBe("E2E tenancy probe");
    const profiles = await (await admin.get("/api/admin/profiles?type=student")).json();
    expect(JSON.stringify(profiles)).not.toContain(r().fixtures.foreignStudentProfileId);
  });

  test("a Supervisor never receives money: invoices and payroll are refused, the session page shows no settlement", async ({ api, open }) => {
    const supervisor = await api("supervisor");
    expect((await supervisor.get("/api/invoices")).status()).toBe(403);
    expect((await supervisor.get("/api/payroll/adjustments")).status()).toBe(403);
    const page = await open("supervisor");
    await visit(page, `/en/admin/sessions/${r().ids.reportSession}`);
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/EGP|USD|hourly rate|payroll ledger/i);
  });

  test("the login page is not an open redirect", async ({ open }) => {
    const page = await open("teacher");
    // A signed-in reader is sent on at once; the redirect is streamed (meta refresh + router).
    for (const target of ["https://evil.example/", "//evil.example/x", "/\\evil.example", "javascript:alert(1)"]) {
      await visit(page, `/en/login?callbackUrl=${encodeURIComponent(target)}`);
      await page.waitForURL("**/en/teacher");
      expect(new URL(page.url()).origin, target).toBe(new URL(BASE_URL).origin);
    }
    await visit(page, `/en/login?callbackUrl=${encodeURIComponent("/en/teacher/payroll")}`);
    await page.waitForURL("**/en/teacher/payroll");
  });

  test("a join link only ever redirects to a validated https Zoom host (SSRF/open redirect)", async ({ api }) => {
    const admin = await api("admin");
    const base = {
      teacherId: r().fixtures.teacherProfileId,
      subjectId: r().fixtures.subjectId,
      sessionType: "PRIVATE",
      scheduledStart: new Date(Date.now() + 9 * 86_400_000).toISOString(),
      scheduledEnd: new Date(Date.now() + 9 * 86_400_000 + 3_600_000).toISOString(),
      timezone: "Africa/Cairo",
      studentIds: [r().fixtures.studentProfileIds.student4],
    };
    for (const zoomJoinUrl of ["https://zoom.us.evil.com/j/123456789", "http://zoom.us/j/123456789", "javascript:alert(1)", "https://evil.example/zoom.us/j/1"]) {
      const response = await admin.post("/api/sessions", { data: { ...base, zoomJoinUrl } });
      expect(response.status(), zoomJoinUrl).toBe(400);
    }
  });
});

test.describe("A02 Security Misconfiguration", () => {
  test("baseline security headers on pages, API answers and static files; no framework banner", async ({ api, open }) => {
    const anon = await api("anon");
    const page = await open("anon");
    await visit(page, "/en/login");
    const script = await page.locator("script[src*='/_next/static/']").first().getAttribute("src");
    for (const path of ["/en", "/en/login", "/api/subjects", "/api/sessions", script!]) {
      const response = await anon.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      expect.soft(headers["x-content-type-options"], path).toBe("nosniff");
      expect.soft(headers["x-frame-options"], path).toBe("DENY");
      expect.soft(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect.soft(headers["x-powered-by"], path).toBeUndefined();
    }
  });

  test("G-A02-1 (fixed): pages carry a nonce CSP; HSTS and Permissions-Policy on every response", async ({ api, open }) => {
    const anon = await api("anon");
    const first = (await anon.get("/en")).headers();
    const policy = first["content-security-policy"] ?? "";
    for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
      expect(policy).toContain(directive);
    }
    expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    // `next dev` needs 'unsafe-eval' and sends no HSTS (production builds only); the
    // run's server mode decides what is expected (E2E_SERVER=dev, playwright.config.ts).
    const productionBuild = process.env.E2E_SERVER !== "dev";
    expect(policy).not.toMatch(productionBuild ? /script-src[^;]*'unsafe-(inline|eval)'/ : /script-src[^;]*'unsafe-inline'/);
    // A fresh nonce on every request.
    const again = (await anon.get("/en")).headers()["content-security-policy"];
    expect(again).not.toBe(policy);
    for (const path of ["/en", "/api/subjects"]) {
      const headers = (await anon.get(path)).headers();
      if (productionBuild) expect.soft(headers["strict-transport-security"], path).toMatch(/^max-age=\d+/);
      else expect.soft(headers["strict-transport-security"], path).toBeUndefined();
      expect.soft(headers["permissions-policy"], path).toContain("camera=()");
    }
    // Next.js put the nonce on every script it rendered.
    const page = await open("anon");
    await visit(page, "/en/login");
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    const scripts = await page.locator("script").evaluateAll((nodes) => nodes.map((node) => (node as HTMLScriptElement).nonce ?? ""));
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every((value) => value.length > 0)).toBe(true);
    // Injected HTML (the stored-XSS shape) cannot run: inline handlers carry no nonce.
    // ('strict-dynamic' still lets page scripts create scripts through DOM APIs — that is how
    // Next.js loads its chunks; the app has no such sink for user data.)
    await page.evaluate(() => {
      const holder = document.createElement("div");
      holder.innerHTML = '<img src="/e2e-missing.png" onerror="window.__cspProbe = 1">';
      document.body.appendChild(holder);
    });
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => (window as unknown as { __cspProbe?: number }).__cspProbe ?? null)).toBeNull();
  });

  test("no source maps, environment files or repository files are served", async ({ api, open }) => {
    const anon = await api("anon");
    const page = await open("anon");
    await visit(page, "/en/login");
    const script = await page.locator("script[src*='/_next/static/']").first().getAttribute("src");
    for (const path of [`${script}.map`, "/.env", "/.env.example", "/package.json", "/.git/config", "/prisma/schema.prisma", "/next.config.ts"]) {
      const response = await anon.get(path, { maxRedirects: 0 });
      expect.soft([404, 307], `${path} answered ${response.status()}`).toContain(response.status());
      expect.soft(await response.text(), path).not.toMatch(/DATABASE_URL|NEXTAUTH_SECRET|\[core\]|sourceMappingURL|"mappings"/);
    }
  });

  test("the session cookie is HttpOnly, SameSite=Lax and encrypted (no readable claims)", async ({ open }) => {
    const page = await open("admin");
    await visit(page, "/en/admin");
    const cookie = (await page.context().cookies()).find((entry) => entry.name.endsWith("next-auth.session-token"));
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("Lax");
    expect(cookie!.value.split(".")).toHaveLength(5); // JWE compact form
    const decoded = cookie!.value.split(".").map((part) => Buffer.from(part, "base64url").toString("latin1")).join(" ");
    expect(decoded).not.toContain(r().users.admin);
    expect(decoded).not.toContain("ADMIN");
    expect(await page.evaluate(() => document.cookie)).not.toContain("session-token");
  });

  test("the app cannot be framed by another site (clickjacking)", async ({ open }) => {
    const page = await open("anon");
    await page.setContent(`<iframe id="f" src="${BASE_URL}/en/login" style="width:600px;height:400px"></iframe>`);
    await page.waitForTimeout(1500);
    const framed = page.frames().find((frame) => frame.url().startsWith(`${BASE_URL}/en/login`));
    const loaded = framed ? await framed.locator("#username").count().catch(() => 0) : 0;
    expect(loaded).toBe(0);
  });
});

test.describe("A03 Software Supply Chain Failures", () => {
  test("production dependencies have no high or critical advisories (npm audit)", async () => {
    test.setTimeout(180_000);
    const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", timeout: 150_000 });
    const report = (() => {
      try {
        return JSON.parse(result.stdout);
      } catch {
        return null;
      }
    })();
    test.skip(!report?.metadata, "npm registry not reachable from this machine");
    const counts = report.metadata.vulnerabilities as Record<string, number>;
    test.info().annotations.push({ type: "npm audit (prod)", description: JSON.stringify(counts) });
    expect(counts.high + counts.critical).toBe(0);
  });

  test("the lockfile pins every dependency (npm ci reproducible)", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(2);
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      expect.soft(lock.packages[`node_modules/${name}`]?.version, name).toBeTruthy();
      expect.soft(lock.packages[`node_modules/${name}`]?.integrity ?? "sha512-local", name).toMatch(/^sha(256|384|512)-/);
    }
  });
});

test.describe("A04 Cryptographic Failures", () => {
  test("no server secret reaches the browser bundles", async ({ open }) => {
    const secrets = ["NEXTAUTH_SECRET", "PAYMOB_HMAC_SECRET", "PAYMOB_API_KEY", "OPENWA_API_KEY", "OPENWA_WEBHOOK_SECRET", "CLOUDINARY_API_SECRET"]
      .map((name) => process.env[name])
      .filter((value): value is string => Boolean(value && value.length >= 8));
    const dbPassword = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).password : "";
    if (dbPassword) secrets.push(dbPassword);
    expect(secrets.length).toBeGreaterThan(0);
    const scripts = new Set<string>();
    const collect = (response: import("@playwright/test").Response) => {
      if (response.url().includes("/_next/static/") && response.url().endsWith(".js")) scripts.add(response.url());
    };
    const anon = await open("anon");
    anon.on("response", collect);
    for (const path of ["/en", "/en/apply", "/en/login"]) await visit(anon, path);
    const page = await open("admin");
    page.on("response", collect);
    for (const path of ["/en/admin", "/en/admin/whatsapp", "/en/admin/billing", "/en/admin/sessions"]) await visit(page, path);
    expect(scripts.size).toBeGreaterThan(3);
    for (const url of scripts) {
      const source = await (await page.request.get(url)).text();
      for (const secret of secrets) expect.soft(source.includes(secret), `a secret appears in ${url}`).toBe(false);
    }
  });

  test("a password set through the app is stored as bcrypt with cost 12 (forced change flow)", async ({ open }) => {
    const { users, password } = r();
    const page = await signIn(open, users.mustChange, password, clientIp("forced-change"));
    await page.waitForURL("**/en/change-password");
    // Every other page sends this user back to the forced change (A07 B4).
    await visit(page, "/en/student");
    expect(new URL(page.url()).pathname).toBe("/en/change-password");
    const fresh = `E2e-${randomUUID().slice(0, 8)}-9x`;
    await page.locator("#currentPassword").fill(password);
    await page.locator("#newPassword").fill(fresh);
    await page.locator("#confirmPassword").fill(fresh);
    await page.getByRole("button", { name: messages.en.changePassword.submit }).click();
    await page.waitForURL("**/en/student");
    const rows = await query<{ password_hash: string; must_change_password: boolean }>(
      "SELECT password_hash, must_change_password FROM users WHERE id = $1",
      [r().fixtures.studentUserIds.student8],
    );
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(rows[0].must_change_password).toBe(false);
  });
});

test.describe("A05 Injection", () => {
  const XSS_TITLE = `<img src=x onerror="window.__xss=1">E2E-XSS-${randomUUID().slice(0, 6)}`;
  const XSS_BODY = `<script>window.__xss=1</script>' OR 1=1; DROP TABLE users; -- <svg onload="window.__xss=1">`;

  test("SQL-looking login input never signs anyone in (form and server)", async ({ open, api }) => {
    const injection = "' OR '1'='1' --";
    // The form refuses it before any request (username charset)…
    const page = await signIn(open, injection, injection, clientIp("sqli-login"));
    await expect(page.locator("#username ~ p, #username").first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/en/login");
    // …and the server, called directly the way a script would, answers a plain failed login.
    const client = await api("anon", { ip: clientIp("sqli-login-direct") });
    const { csrfToken } = await (await client.get("/api/auth/csrf")).json();
    for (const [username, password] of [[injection, injection], [r().users.teacher2, injection], ["admin'--", "x"]]) {
      const response = await client.post("/api/auth/callback/credentials", {
        form: { username, password, csrfToken, json: "true" },
        maxRedirects: 0,
      });
      expect.soft(response.status(), username).toBeLessThan(500);
      expect.soft(response.headers()["location"] ?? (await response.text()), username).toContain("error=");
    }
    const session = await (await client.get("/api/auth/session")).json();
    expect(session?.user).toBeUndefined();
  });

  test("stored XSS: a complaint's HTML is shown as text to the Admin and never runs", async ({ api, open }) => {
    const guardian = await api("guardian");
    const filed = await guardian.post("/api/complaints", {
      data: { sessionId: r().ids.absentSession, concernedUserId: r().fixtures.teacherUserId, category: "OTHER", title: XSS_TITLE, body: XSS_BODY },
    });
    expect(filed.status()).toBe(201);
    const [row] = await query<{ id: string }>("SELECT id FROM complaints WHERE academy_id = $1 AND title = $2", [r().fixtures.academyId, XSS_TITLE]);
    const page = await open("admin");
    let dialog = false;
    page.on("dialog", (prompt) => {
      dialog = true;
      void prompt.dismiss();
    });
    await visit(page, `/en/admin/complaints/${row.id}`);
    await expect(page.getByText(XSS_TITLE).first()).toBeVisible();
    await expect(page.getByText("<script>window.__xss=1</script>", { exact: false }).first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    expect(await page.locator("main img[src='x'], main svg[onload]").count()).toBe(0);
    expect(dialog).toBe(false);
    expect(errorsOf(page)).toEqual([]);
  });

  test("stored XSS: an announcement's HTML is shown as text to the family", async ({ api, open }) => {
    const admin = await api("admin");
    const recipients = await (await admin.get("/api/announcements/recipients")).json();
    const count = recipients?.data?.whatsappRecipients;
    expect(typeof count).toBe("number");
    const created = await admin.post("/api/announcements", { data: { title: XSS_TITLE, body: XSS_BODY, confirmRecipientCount: count } });
    expect(created.status(), await created.text()).toBe(201);
    const page = await open("guardian");
    await visit(page, "/en/announcements");
    await expect(page.getByText(XSS_TITLE).first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    expect(errorsOf(page)).toEqual([]);
  });

  test("filter and enum parameters reject injection instead of widening the query", async ({ api }) => {
    const supervisor = await api("supervisor");
    for (const type of ["constructor", "' OR 1=1 --", "__proto__", "student;DROP TABLE users"]) {
      const response = await supervisor.get(`/api/admin/profiles?type=${encodeURIComponent(type)}`);
      expect.soft(response.status(), type).toBe(400);
    }
  });
});

test.describe("A06 Insecure Design", () => {
  test("a teacher cannot report on a session that has not ended", async ({ api }) => {
    const teacher = await api("teacher");
    const response = await teacher.post(`/api/sessions/${r().ids.soonSession}/students/${r().fixtures.studentProfileIds.student1}/report`, {
      data: { attendanceOutcome: "ATTENDED", classRemark: "good", summary: "Too early", homework: "None", language: "en" },
    });
    expect([400, 409]).toContain(response.status());
  });

  test("an announcement whose recipient count is stale is refused (explicit confirmation)", async ({ api }) => {
    const admin = await api("admin");
    const response = await admin.post("/api/announcements", { data: { title: "Stale count", body: "Should not send", confirmRecipientCount: 99999 } });
    expect(response.status()).toBe(409);
  });
});

test.describe("A07 Identification and Authentication Failures", () => {
  test("wrong password and unknown user get the same generic message (no account enumeration)", async ({ open }) => {
    const known = await signIn(open, r().users.teacher2, "Definitely-Wrong-1", clientIp("enum-known"));
    await expect(known.getByText(messages.en.login.invalidCredentials)).toBeVisible();
    const unknown = await signIn(open, `nobody_${randomUUID().slice(0, 8)}`, "Definitely-Wrong-1", clientIp("enum-unknown"));
    await expect(unknown.getByText(messages.en.login.invalidCredentials)).toBeVisible();
  });

  test("three wrong passwords block that sign-in for 15 minutes, but not the real user elsewhere (D90)", async ({ open }) => {
    const { users, password } = r();
    const attacker = clientIp("brute-attacker");
    for (let attempt = 0; attempt < 3; attempt++) {
      const page = await signIn(open, users.rateLimited, `Wrong-Pass-${attempt}x`, attacker);
      await expect(page.getByText(messages.en.login.invalidCredentials)).toBeVisible();
    }
    // Blocked from that address, even with the right password.
    const blocked = await signIn(open, users.rateLimited, password, attacker);
    await expect(blocked.getByText(messages.en.login.invalidCredentials)).toBeVisible();
    expect(new URL(blocked.url()).pathname).toBe("/en/login");
    // The real user at another address still signs in.
    const owner = await signIn(open, users.rateLimited, password, clientIp("brute-real-user"));
    await owner.waitForURL((url) => !url.pathname.endsWith("/login"));
  });

  test("a submit before the page script runs never puts the password in the URL", async ({ open }) => {
    const page = await open("anon", { javaScriptEnabled: false, ip: clientIp("no-js-login") });
    await page.goto("/en/login");
    await page.locator("#username").fill("someone");
    await page.locator("#password").fill("Secret-In-Url-1");
    await page.locator("form button[type=submit]").first().click();
    await page.waitForLoadState("load");
    expect(page.url()).not.toContain("Secret-In-Url-1");
    expect(page.url()).not.toContain("password=");
  });

  test("signing out removes the session; protected pages then ask to log in", async ({ open, browser }) => {
    const page = await open("guardian");
    await visit(page, "/en/guardian");
    // Sign out sits in the user menu (the button carries the user's display name).
    await page.getByRole("button", { name: /Demo Test guardian/ }).first().click();
    await page.getByRole("menu").getByRole("button", { name: messages.en.signOut }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/en/guardian"));
    const cookies = await page.context().cookies();
    expect(cookies.some((cookie) => cookie.name.endsWith("session-token"))).toBe(false);
    await visit(page, "/en/guardian");
    expect(new URL(page.url()).pathname).toBe("/en/login");
    // Note (stateless JWT, 8 h maxAge): a token copied before sign-out stays valid until it
    // expires. Recorded in the report; the saved state below still works on purpose.
    const copied = await browser.newContext({ storageState: "e2e/.run/state-guardian.json" });
    const response = await copied.request.get(`${BASE_URL}/api/notifications`, { headers: { "x-forwarded-for": clientIp("copied-token") } });
    test.info().annotations.push({ type: "copied token after sign-out", description: `HTTP ${response.status()}` });
    await copied.close();
  });

  test("the global limit answers 429 after 120 requests a minute from one client", async ({ api }) => {
    const client = await api("anon", { ip: clientIp(`flood-${Date.now()}`) });
    const statuses: number[] = [];
    for (let index = 0; index < 125; index++) statuses.push((await client.get("/api/subjects")).status());
    expect(statuses.slice(0, 120).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(120)).toContain(429);
  });

  test("G-A07-5 (fixed): a forged X-Forwarded-For cannot reset the per-client limits", async ({ playwright }) => {
    // Behind the (one, default) reverse proxy a client's own header arrives as
    // "<whatever it sent>, <address the proxy saw>". Only the proxy's entry picks the bucket.
    // The run has no proxy in front, so the test plays the proxy's part and appends the
    // "real" entry itself. A client that reaches the app port directly writes the whole
    // header; that cannot be told apart, which is why the app must only be reachable
    // through its proxy (deploy-checklist.md §1).
    const client = await playwright.request.newContext({ baseURL: BASE_URL });
    // 100.64.0.0/10 is never produced by clientIp(), so no other test shares this bucket.
    const real = `100.64.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
    const statuses: number[] = [];
    for (let index = 0; index < 130; index++) {
      statuses.push((await client.get("/api/subjects", { headers: { "x-forwarded-for": `192.0.2.${index % 250}, ${real}` } })).status());
    }
    await client.dispose();
    expect(statuses.slice(0, 120).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(120)).toContain(429);
  });
});

test.describe("A08 Software or Data Integrity Failures", () => {
  const paymobFields = [
    "amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction", "id", "integration_id", "is_3d_secure",
    "is_auth", "is_capture", "is_refunded", "is_standalone_payment", "is_voided", "order.id", "owner", "pending",
    "source_data.pan", "source_data.sub_type", "source_data.type", "success",
  ];
  const read = (event: Record<string, unknown>, path: string) =>
    path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), event);

  test("a Paymob callback with a forged signature is refused and stores nothing", async ({ api }) => {
    const anon = await api("anon", { origin: null });
    const id = 880000000 + Math.floor(Math.random() * 1_000_000);
    const txn = {
      id, success: true, pending: false, is_voided: false, is_refunded: false, is_auth: false, is_capture: false, error_occured: false,
      amount_cents: 80000, currency: "EGP", order: { id: 123456 }, created_at: new Date().toISOString(), integration_id: 1,
      source_data: { pan: "1234", sub_type: "Visa", type: "card" },
    };
    const forged = createHmac("sha512", "not-the-secret").update(paymobFields.map((field) => String(read(txn, field) ?? "")).join("")).digest("hex");
    const response = await anon.post(`/api/payments/paymob/webhook?hmac=${forged}`, { headers: json, data: { type: "TRANSACTION", obj: txn } });
    expect(response.status()).toBe(401);
    const stored = await query("SELECT 1 FROM webhook_events WHERE provider_event_id LIKE $1", [`${id}%`]);
    expect(stored).toHaveLength(0);
  });

  test("a Paymob subscription callback with a forged signature is refused", async ({ api }) => {
    const anon = await api("anon", { origin: null });
    const body = { trigger_type: "successful transaction", subscription_data: { id: 4242 }, hmac: "0".repeat(128) };
    expect((await anon.post("/api/payments/paymob/subscription-webhook", { headers: json, data: body })).status()).toBe(401);
  });

  test("the OpenWA delivery webhook accepts only bodies signed with the shared secret", async ({ api }) => {
    const anon = await api("anon", { origin: null });
    const body = JSON.stringify({ event: "message.ack", sessionId: process.env.OPENWA_SESSION_ID, timestamp: new Date().toISOString(), data: { messageId: "e2e-unknown", status: "read" } });
    const bad = await anon.post("/api/whatsapp/status", { headers: { ...json, "x-openwa-signature": `sha256=${"0".repeat(64)}` }, data: body });
    expect(bad.status()).toBe(401);
    const none = await anon.post("/api/whatsapp/status", { headers: json, data: body });
    expect(none.status()).toBe(401);
    const secret = process.env.OPENWA_WEBHOOK_SECRET;
    test.skip(!secret, "OPENWA_WEBHOOK_SECRET is not set in .env");
    const signature = createHmac("sha256", secret!).update(body).digest("hex");
    const good = await anon.post("/api/whatsapp/status", { headers: { ...json, "x-openwa-signature": `sha256=${signature}` }, data: body });
    expect(good.status()).toBe(200);
  });
});

test.describe("A09 Security Logging and Alerting Failures", () => {
  test("the server log holds no password, secret or phone number from this run", async () => {
    const file = "e2e/.run/server.log";
    test.skip(!existsSync(file), "server log not captured (app started outside Playwright without tee)");
    const log = readFileSync(file, "utf8");
    const forbidden = [
      r().password, "Definitely-Wrong-1", "Secret-In-Url-1", "Wrong-Pass-0x",
      process.env.NEXTAUTH_SECRET, process.env.OPENWA_API_KEY, process.env.OPENWA_WEBHOOK_SECRET, process.env.PAYMOB_HMAC_SECRET,
      ...Array.from({ length: 25 }, (_, index) => `202555${String(150 + index).padStart(4, "0")}`),
    ].filter((value): value is string => Boolean(value));
    for (const value of forbidden) expect.soft(log.includes(value), `log contains a forbidden value (${value.slice(0, 3)}…)`).toBe(false);
  });
});

test.describe("A10 Mishandling of Exceptional Conditions", () => {
  test("malformed JSON is a 400 with a coded error, never a 500 or a stack trace", async ({ api }) => {
    const admin = await api("admin");
    const teacher = await api("teacher");
    const anon = await api("anon");
    // (The guardian already filed complaints in this run; its per-user complaint limit would answer 429.)
    const cases: [typeof admin, string][] = [
      [admin, "/api/sessions"], [admin, "/api/admin/messages"], [admin, "/api/announcements"], [admin, "/api/admin/users"],
      [admin, "/api/invoices"], [teacher, "/api/complaints"], [anon, "/api/applications"],
    ];
    for (const [client, path] of cases) {
      const response = await call(() => client.post(path, { headers: json, data: "{ not json" }));
      const text = await response.text();
      expect.soft(response.status(), path).toBe(400);
      expect.soft(text, path).not.toMatch(/\bat \S+:\d+:\d+|PrismaClient|prisma\.|node_modules|Error:/);
    }
  });

  test("hostile ids and oversized bodies are refused cleanly", async ({ api }) => {
    const admin = await api("admin");
    for (const id of ["not-a-uuid", "' OR 1=1 --", "..%2F..%2Fetc%2Fpasswd", "%00"]) {
      for (const path of [`/api/invoices/${id}`, `/api/admin/teachers/${id}/context`, `/api/applications/${id}`]) {
        const response = await call(() => admin.get(path));
        expect.soft([400, 404], `${path} answered ${response.status()}`).toContain(response.status());
      }
    }
    const anon = await api("anon");
    const huge = await anon.post("/api/applications", { headers: json, data: JSON.stringify({ type: "STUDENT", notes: "x".repeat(2_000_000) }) });
    expect(huge.status()).toBe(413);
  });

  test("an unknown API path is a plain 404 without internals", async ({ api }) => {
    const response = await (await api("anon")).get(`/api/e2e-${randomUUID()}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toMatch(/\bat \S+:\d+:\d+|node_modules/);
  });
});
