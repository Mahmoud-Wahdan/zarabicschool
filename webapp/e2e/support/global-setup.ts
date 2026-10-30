import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

import { FIXTURE_FILE } from "./run";

/** Creates the per-run test academy (unless E2E_REUSE_FIXTURE=1 and one exists). */
export default function globalSetup() {
  mkdirSync("e2e/.run", { recursive: true });
  if (process.env.E2E_REUSE_FIXTURE === "1" && existsSync(FIXTURE_FILE)) return;
  const result = spawnSync(
    "npx",
    ["tsx", "--require", "./scripts/perf/server-only-shim.cjs", "e2e/support/fixture.ts", "create"],
    { stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) throw new Error("E2E fixture creation failed (see the output above).");
}
