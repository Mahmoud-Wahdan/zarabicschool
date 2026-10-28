/**
 * Asset load of one page in a fresh browser (L1, 2026-10-28): how many files the
 * page needs, how many fail, bytes, and the time to the load event.
 *
 *   node scripts/perf/assets.mjs <baseUrl> [path] [runs]
 *
 * Prints counts only (no URLs), so a tunnel address never lands in a log.
 */
import { chromium } from "playwright";

const [baseUrl, path = "/ar/login", runsArg = "3"] = process.argv.slice(2);
const tunnel = !baseUrl.startsWith("http://localhost");
const browser = await chromium.launch();
for (let run = 1; run <= Number(runsArg); run++) {
  const context = await browser.newContext(tunnel ? { userAgent: "zarabic-perf-probe/1.0" } : {});
  const page = await context.newPage();
  const stats = { requests: 0, failed: 0, status5xx: 0, bytes: 0 };
  page.on("request", () => stats.requests++);
  page.on("requestfailed", () => stats.failed++);
  page.on("response", async (response) => {
    if (response.status() >= 500) stats.status5xx++;
    const length = Number(response.headers()["content-length"] ?? 0);
    stats.bytes += Number.isFinite(length) ? length : 0;
  });
  const started = Date.now();
  let outcome = "ok";
  try {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "load", timeout: 120_000 });
  } catch {
    outcome = "timeout";
  }
  const loadMs = Date.now() - started;
  await page.waitForTimeout(3000);
  const hydrated = await page.evaluate(() => { const form = document.querySelector("form, main"); return !!form && Object.keys(form).some((key) => key.startsWith("__react")); }).catch(() => false);
  console.log(`run ${run}: ${outcome} load ${loadMs} ms, requests ${stats.requests}, failed ${stats.failed}, 5xx ${stats.status5xx}, ~${Math.round(stats.bytes / 1024)} KiB (content-length), hydrated ${hydrated}`);
  await context.close();
}
await browser.close();
