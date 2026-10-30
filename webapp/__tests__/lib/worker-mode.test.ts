import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("../../lib/worker/notifications", () => ({ runWorkerTick: jest.fn().mockResolvedValue(undefined) }));

import { workerRunsInWeb } from "../../lib/config/worker-mode";
import { runWorkerLoop } from "../../lib/worker/standalone";
import { runWorkerTick } from "../../lib/worker/notifications";

/**
 * Staging (D95, owner 2026-10-30): the web app (`next start`) and the worker run as
 * separate processes. WORKER_MODE=separate keeps the worker out of the web process;
 * `npm run worker` runs the same ticks on its own, one at a time, until stopped.
 */
describe("worker as its own process", () => {
  it("WM-01: the web process runs the worker unless WORKER_MODE=separate", () => {
    expect(workerRunsInWeb({})).toBe(true);
    expect(workerRunsInWeb({ WORKER_MODE: "" })).toBe(true);
    expect(workerRunsInWeb({ WORKER_MODE: "separate" })).toBe(false);
    expect(workerRunsInWeb({ WORKER_MODE: " Separate " })).toBe(false);
  });

  it("WM-02: instrumentation starts the in-process worker only through that switch", () => {
    const source = readFileSync(join(process.cwd(), "instrumentation.ts"), "utf8");
    expect(source).toMatch(/workerRunsInWeb\(\)/);
  });

  it("WM-03: the standalone loop runs ticks one at a time and stops on its signal", async () => {
    const tick = runWorkerTick as jest.Mock;
    tick.mockClear();
    await runWorkerLoop({ once: true });
    expect(tick).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    let calls = 0;
    tick.mockImplementation(async () => {
      calls += 1;
      if (calls === 3) controller.abort();
    });
    await runWorkerLoop({ intervalMs: 1, signal: controller.signal });
    expect(calls).toBe(3);
  });
});
