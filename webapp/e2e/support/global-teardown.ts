import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { FIXTURE_FILE } from "./run";

/** Removes the per-run test academy (kept with E2E_KEEP_FIXTURE=1 for debugging). */
export default function globalTeardown() {
  if (process.env.E2E_KEEP_FIXTURE === "1" || !existsSync(FIXTURE_FILE)) return;
  const result = spawnSync(
    "npx",
    ["tsx", "--require", "./scripts/perf/server-only-shim.cjs", "e2e/support/fixture.ts", "cleanup"],
    { stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) throw new Error("E2E fixture cleanup failed (see the output above).");
}
