import { runWorkerTick } from "./notifications";

/**
 * The worker as its own process (`npm run worker`, staging D95): the same ticks as the
 * in-process worker (lib/worker/start.ts), one at a time, every `intervalMs`, until the
 * signal aborts (SIGINT/SIGTERM in scripts/worker.ts). `once` runs a single tick.
 */
const POLL_INTERVAL_MS = 60_000;

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function runWorkerLoop(options: { once?: boolean; intervalMs?: number; signal?: AbortSignal } = {}) {
  const interval = options.intervalMs ?? POLL_INTERVAL_MS;
  do {
    try {
      await runWorkerTick(new Date());
    } catch (cause) {
      // runWorkerTick isolates each step; this only guards the loop itself.
      console.error("[worker] tick failed.", cause instanceof Error ? cause.message : cause);
    }
    if (options.once || options.signal?.aborted) return;
    await wait(interval, options.signal);
  } while (!options.signal?.aborted);
}
