import "server-only";

import { runWorkerTick } from "./notifications";

const POLL_INTERVAL_MS = 60_000;
const globalForWorker = globalThis as typeof globalThis & { __zarabicWorkerStarted?: boolean };

export function startSchedulingWorker() {
  if (globalForWorker.__zarabicWorkerStarted) return;
  globalForWorker.__zarabicWorkerStarted = true;
  // One tick at a time: sends are spaced (OpenWA ban risk), so a busy tick can
  // outlast the interval; an overlapping tick would double the send rate.
  let tickRunning = false;
  const timer = setInterval(() => {
    if (tickRunning) return;
    tickRunning = true;
    void runWorkerTick(new Date()).finally(() => {
      tickRunning = false;
    });
  }, POLL_INTERVAL_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
}

startSchedulingWorker();
