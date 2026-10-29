import { existsSync, statSync } from "node:fs";

import { expect, test as setup } from "@playwright/test";

import { clientIp, ROLE_HOME, ROLES, run, statePath } from "./support/run";

/**
 * One real sign-in through the login form per role; the specs reuse the saved
 * browser states. The login limit (5 per 10 min per username and per client
 * address) is why the specs do not sign in again for every test.
 */
/** E2E_REUSE_STATE=1: keep a saved state younger than 7 h (the JWT lives 8 h) — for quick re-runs. */
function reusable(path: string) {
  return process.env.E2E_REUSE_STATE === "1" && existsSync(path) && Date.now() - statSync(path).mtimeMs < 7 * 3600 * 1000;
}

for (const role of ROLES) {
  setup(`sign in as ${role}`, async ({ browser }) => {
    setup.skip(reusable(statePath(role)), "fresh saved state reused (E2E_REUSE_STATE=1)");
    const { users, password } = run();
    const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": clientIp(`login-${role}`) } });
    const page = await context.newPage();
    await page.goto("/en/login");
    await page.locator("#username").fill(users[role]);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Enter the platform" }).click();
    await page.waitForURL(`**/en${ROLE_HOME[role]}`);
    await expect(page.locator("h1").first()).toBeVisible();
    await context.storageState({ path: statePath(role) });
    await context.close();
  });
}
