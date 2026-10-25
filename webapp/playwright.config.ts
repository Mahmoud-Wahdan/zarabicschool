import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 3 E2E — Zarabicschool
 * Runs against the local dev server and the development database only.
 * Requires seeded demo data (npm run db:seed:demo) and E2E_* credential env vars.
 */
export default defineConfig({
  testDir: "./e2e",
  // The specs drive one shared dev database through one browser session flow.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
