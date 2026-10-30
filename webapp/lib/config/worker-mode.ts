/**
 * Where the DB-polling worker runs (staging D95, owner 2026-10-30). By default the web
 * process starts it (instrumentation.ts) — the local development setup. With
 * WORKER_MODE=separate the web process never starts it and `npm run worker` runs it as
 * its own process (one worker instance only: its sends are spaced for OpenWA).
 */
export function workerRunsInWeb(env: Record<string, string | undefined> = process.env): boolean {
  return (env.WORKER_MODE ?? "").trim().toLowerCase() !== "separate";
}
