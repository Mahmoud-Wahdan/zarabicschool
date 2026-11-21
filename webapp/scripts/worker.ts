import { runWorkerLoop } from "../lib/worker/standalone";

/**
 * Entry point for the worker as its own process (`npm run worker`, WORKER_MODE=separate).
 * Runs until SIGINT/SIGTERM; pass `--once` to run a single tick and exit.
 */
async function main() {
  const once = process.argv.includes("--once");
  const controller = new AbortController();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`[worker] received ${signal}, shutting down.`);
      controller.abort();
    });
  }

  console.log(`[worker] starting${once ? " (single tick)" : ""}.`);
  await runWorkerLoop({ once, signal: controller.signal });
  console.log("[worker] stopped.");
}

main().then(
  () => process.exit(0),
  (cause) => {
    console.error("[worker] crashed.", cause instanceof Error ? cause.message : cause);
    process.exit(1);
  },
);
