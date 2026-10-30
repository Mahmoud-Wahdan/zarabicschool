/**
 * `npm run worker` — the DB-polling worker as its own process (staging D95). Start the
 * web app with WORKER_MODE=separate so only this process runs the worker. Env comes from
 * the process (e.g. `node --env-file=...`) and then `.env` (never overriding). Stops
 * cleanly on SIGINT/SIGTERM after the current tick. `--once` runs one tick (smoke test).
 */
import { runWorkerLoop } from "../lib/worker/standalone";
import { disconnectPrisma } from "../lib/prisma";

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => controller.abort());

const once = process.argv.includes("--once");
console.info(`[worker] started${once ? " (one tick)" : ""}.`);
runWorkerLoop({ once, signal: controller.signal })
  .then(() => console.info("[worker] stopped."))
  .catch((cause) => {
    console.error("[worker] stopped on an error.", cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  })
  // Ends the client AND its pg pool; idle pooled connections would keep the process alive.
  .finally(() => disconnectPrisma());
