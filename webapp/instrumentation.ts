import { assertMessagingProviderAllowed } from "./lib/config/messaging-mode";

export async function register() {
  // Fail the production start on a dev/test messaging provider (owner, 2026-10-27).
  assertMessagingProviderAllowed();
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // C7: start the worker without blocking server startup on its module graph.
    void import("./lib/worker/start").catch((cause) => {
      console.error("[worker] failed to start.", cause instanceof Error ? cause.message : cause);
    });
  }
}
