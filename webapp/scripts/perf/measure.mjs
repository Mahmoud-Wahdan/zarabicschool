/**
 * Page timing + query count + badge requests (L1 / A5, 2026-10-28).
 *
 *   node scripts/perf/measure.mjs <baseUrl> <label> [runs]
 *
 * Needs PERF_FIXTURE (users from fixture.ts) and, for query counts, the server
 * started with the preload and PERF_QUERY_LOG pointing at the same file as here.
 * Pages are loaded one at a time, so the queries logged between the start and the
 * end of a load belong to that load (the worker is off with PERF_NO_WORKER=1).
 * Prints a table and writes <label>.json next to the fixture file. Nothing secret
 * is printed: usernames are test-fixture names, the password is the fixture one.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const [baseUrl, label = "run", runsArg = "3"] = process.argv.slice(2);
const runs = Number(runsArg);
const fixture = JSON.parse(readFileSync(process.env.PERF_FIXTURE, "utf8"));
const queryLog = process.env.PERF_QUERY_LOG;
const PASSWORD = "Demo-Test-Pass-1!";
// ngrok's free plan shows a warning page to browser user agents. A custom User-Agent
// skips it; an extra request header would not work, because the page's script chunks
// load in CORS mode and a custom header needs a preflight the app does not answer.
const TUNNEL_OPTIONS = baseUrl.startsWith("http://localhost") ? {} : { userAgent: "zarabic-perf-probe/1.0" };

const PAGES = {
  ADMIN: ["/ar/admin", "/ar/admin/sessions", "/ar/admin/enrollments", "/ar/admin/invoices"],
  TEACHER: ["/ar/teacher"],
  STUDENT: ["/ar/student"],
  GUARDIAN: ["/ar/guardian"],
};

const readQueries = () => (queryLog && existsSync(queryLog) ? readFileSync(queryLog, "utf8").trim().split("\n").filter(Boolean).map((line) => line.split(" ").map(Number)) : []);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};

const browser = await chromium.launch();
const results = [];
let softNavigation = null;

const ONLY = process.env.PERF_ROLES ? process.env.PERF_ROLES.split(",") : null;
for (const [role, pages] of Object.entries(PAGES)) {
  if (ONLY && !ONLY.includes(role)) continue;
  // One login per role, then the saved session is reused (the login limit is 5 per 10 min per IP).
  const stateFile = join(dirname(process.env.PERF_FIXTURE), `state-${role}.json`);
  const host = new URL(baseUrl).host.replace(/[^a-z0-9]/gi, "_");
  const stateForHost = stateFile.replace(".json", `-${host}.json`);
  const context = await browser.newContext({ ...TUNNEL_OPTIONS, ...(existsSync(stateForHost) ? { storageState: stateForHost } : {}) });
  const page = await context.newPage();
  let badgeRequests = 0;
  let appRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/notifications/badge")) badgeRequests++;
    // Requests that pass the proxy's 120/min/IP limit (everything but static files).
    if (!/\/_next\/static\/|\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/.test(new URL(request.url()).pathname)) appRequests++;
  });

  if (!existsSync(stateForHost)) {
    await page.goto(`${baseUrl}/ar/login`, { waitUntil: "networkidle", timeout: 300_000 });
    // Wait for hydration (React attaches __reactFiber keys), or the form posts natively.
    for (let attempt = 0; attempt < 100; attempt++) {
      const hydrated = await page.evaluate(() => { const form = document.querySelector("form"); return !!form && Object.keys(form).some((key) => key.startsWith("__react")); }).catch(() => false);
      if (hydrated) break;
      await page.waitForTimeout(3000);
    }
    await page.fill("#username", fixture.users[role]);
    await page.fill("#password", PASSWORD);
    await Promise.all([page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 120_000 }), page.click("button[type=submit]")]);
    await page.waitForLoadState("networkidle");
    await context.storageState({ path: stateForHost });
  }

  for (const path of pages) {
    const samples = [];
    for (let run = 0; run < runs; run++) {
      let before = readQueries().length;
      badgeRequests = 0;
      appRequests = 0;
      let started = Date.now();
      let response = await page.goto(`${baseUrl}${path}`, { waitUntil: "load", timeout: 120_000 });
      if (response.status() === 429) {
        // The proxy's per-IP limit (120 requests/min): wait for the window, then retry.
        console.log("  429 from the rate limit: waiting 61 s");
        await page.waitForTimeout(61_000);
        before = readQueries().length;
        badgeRequests = 0;
        appRequests = 0;
        started = Date.now();
        response = await page.goto(`${baseUrl}${path}`, { waitUntil: "load", timeout: 120_000 });
      }
      const loaded = Date.now() - started;
      const timing = response.request().timing();
      await page.waitForLoadState("networkidle");
      const window = readQueries().slice(before).filter(([end]) => end <= Date.now());
      samples.push({
        status: response.status(),
        ttfbMs: Math.round(timing.responseStart),
        loadMs: loaded,
        queries: window.length,
        queryMs: Math.round(window.reduce((sum, [, ms]) => sum + ms, 0)),
        badgeRequests,
        appRequests,
      });
    }
    // The first sample of a fresh dev server includes compilation: report the median.
    const row = {
      role, path, status: samples.at(-1).status,
      ttfbMs: median(samples.map((s) => s.ttfbMs)), loadMs: median(samples.map((s) => s.loadMs)),
      queries: median(samples.map((s) => s.queries)), queryMs: median(samples.map((s) => s.queryMs)),
      badgePerLoad: median(samples.map((s) => s.badgeRequests)), appRequests: median(samples.map((s) => s.appRequests)), first: samples[0],
    };
    results.push(row);
    console.log(`${role.padEnd(8)} ${path.padEnd(24)} ttfb ${String(row.ttfbMs).padStart(6)} ms  load ${String(row.loadMs).padStart(6)} ms  queries ${String(row.queries).padStart(3)} (${row.queryMs} ms)  badge/load ${row.badgePerLoad}  app req ${row.appRequests}  [first: ttfb ${row.first.ttfbMs} load ${row.first.loadMs}]`);
  }

  if (role === "ADMIN") {
    // A5: soft navigation through the sidebar after the first load.
    await page.goto(`${baseUrl}/ar/admin`, { waitUntil: "load" });
    await page.waitForLoadState("networkidle");
    badgeRequests = 0;
    const visited = [];
    const links = await page.locator("aside nav a[href^='/ar/admin/']").evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href")));
    for (const href of [...new Set(links)].slice(0, 6)) {
      const link = page.locator(`aside nav a[href='${href}']`).first();
      if (!(await link.count())) break;
      await link.click();
      await page.waitForURL((url) => url.pathname === href, { timeout: 120_000 });
      await page.waitForLoadState("networkidle");
      visited.push(href);
    }
    softNavigation = { pages: visited.length, badgeRequests };
    console.log(`A5 soft navigation: ${visited.length} pages, ${badgeRequests} badge request(s)`);
  }
  await context.close();
}

await browser.close();
const out = join(dirname(process.env.PERF_FIXTURE), `${label}.json`);
writeFileSync(out, JSON.stringify({ label, baseUrl: baseUrl.startsWith("http://localhost") ? baseUrl : "(tunnel)", at: new Date().toISOString(), results, softNavigation }, null, 2));
console.log(`written ${out}`);
