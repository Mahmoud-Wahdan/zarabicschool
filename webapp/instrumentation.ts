import { assertMessagingProviderAllowed } from "./lib/config/messaging-mode";
import { workerRunsInWeb } from "./lib/config/worker-mode";

export async function register() {
  // Fail the production start on a dev/test messaging provider (owner, 2026-10-27).
  assertMessagingProviderAllowed();
  // WORKER_MODE=separate: the worker runs as its own process (`npm run worker`, D95).
  if (process.env.NEXT_RUNTIME === "nodejs" && workerRunsInWeb()) {
    // C7: start the worker without blocking server startup on its module graph.
    void import("./lib/worker/start").catch((cause) => {
      console.error("[worker] failed to start.", cause instanceof Error ? cause.message : cause);
    });
  }
}
