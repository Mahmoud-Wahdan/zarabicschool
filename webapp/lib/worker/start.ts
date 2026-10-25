import "server-only";

import { runWorkerTick } from "./notifications";

const POLL_INTERVAL_MS = 60_000;
const globalForWorker = globalThis as typeof globalThis & { __zarabicWorkerStarted?: boolean };

export function startSchedulingWorker() {
  if (globalForWorker.__zarabicWorkerStarted) return;
  globalForWorker.__zarabicWorkerStarted = true;
  const timer = setInterval(() => {
    void runWorkerTick(new Date());
  }, POLL_INTERVAL_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
}

startSchedulingWorker();
