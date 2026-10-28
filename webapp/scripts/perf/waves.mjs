/**
 * Query waves of one page load (L1, 2026-10-28):
 *
 *   node scripts/perf/waves.mjs <baseUrl> <ROLE> <path>
 *
 * Uses the login state saved by measure.mjs. Reads the preload's query log (times and
 * durations only) for the one load and groups the queries into waves: a new wave
 * starts when a query begins after every earlier query has ended. With a remote
 * database each wave costs at least one round trip, so waves x RTT is the floor of
 * the server time; fewer waves = run independent queries together.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const [baseUrl, role, path] = process.argv.slice(2);
const queryLog = process.env.PERF_QUERY_LOG;
const read = () => (existsSync(queryLog) ? readFileSync(queryLog, "utf8").trim().split("\n").filter(Boolean).map((line) => line.split(" ").map(Number)) : []);
const host = new URL(baseUrl).host.replace(/[^a-z0-9]/gi, "_");
const state = join(dirname(process.env.PERF_FIXTURE), `state-${role}-${host}.json`);

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: state });
const page = await context.newPage();
const before = read().length;
const started = Date.now();
const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "load", timeout: 120_000 });
await page.waitForLoadState("networkidle").catch(() => undefined);
const queries = read().slice(before).map(([end, ms]) => ({ start: end - ms, end, ms }));
queries.sort((a, b) => a.start - b.start);
const waves = [];
for (const query of queries) {
  const last = waves.at(-1);
  if (last && query.start < last.end) {
    last.count++;
    last.end = Math.max(last.end, query.end);
  } else {
    waves.push({ count: 1, start: query.start, end: query.end });
  }
}
console.log(`${role} ${path}: status ${response.status()}, ${queries.length} queries in ${waves.length} waves, avg query ${Math.round(queries.reduce((s, q) => s + q.ms, 0) / Math.max(1, queries.length))} ms`);
console.log(`  waves (queries@offset ms): ${waves.map((wave) => `${wave.count}@${wave.start - started}`).join("  ")}`);
if (process.env.DETAIL) for (const q of queries) console.log(`    q start ${Math.round(q.start - started)} ms, ${Math.round(q.ms)} ms`);
await browser.close();
