export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // C7: start the worker without blocking server startup on its module graph.
    void import("./lib/worker/start").catch((cause) => {
      console.error("[worker] failed to start.", cause instanceof Error ? cause.message : cause);
    });
  }
}
