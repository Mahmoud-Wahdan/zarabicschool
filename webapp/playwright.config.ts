import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env", quiet: true });

/**
 * Whole-site E2E — Zarabicschool (e2e/README.md).
 * Runs against a production build (`next start`) by default, a per-run test academy
 * (e2e/support/fixture.ts), the Paymob test double, and the local OpenWA if it runs.
 * E2E_SERVER=dev uses `next dev` instead; E2E_BASE_URL points at an already running app.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const executablePath = process.env.E2E_CHROMIUM_PATH || undefined;

// For the server Playwright starts (inherited from this process; .env never overrides
// a variable that is already set) and for the specs: Paymob only through the local test
// double, never the real API; the run's own origin allowed; OpenWA as configured (started
// below with the run), or a closed port with E2E_WHATSAPP=off (scripts/perf/serve.sh; the
// WhatsApp spec then FAILS with that reason — owner 2026-10-31: no skipped tests).
process.env.PAYMOB_API_URL = "http://127.0.0.1:4010";
process.env.PAYMOB_API_KEY ||= "e2e-double";
process.env.PAYMOB_INTEGRATION_ID_EGP ||= "1";
process.env.PAYMOB_IFRAME_ID_EGP ||= "1";
process.env.PAYMOB_HMAC_SECRET ||= "e2e-paymob-test-hmac";
process.env.ALLOWED_ORIGINS = new URL(baseURL).origin;
process.env.MESSAGING_PROVIDER = ""; // a production start refuses console/fake
if (process.env.E2E_WHATSAPP === "off") process.env.OPENWA_URL = "http://127.0.0.1:9";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/support/global-setup.ts",
  globalTeardown: "./e2e/support/global-teardown.ts",
  // One shared database and the app's in-memory rate limits: one worker, in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "e2e/.run/results.json" }]],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    // The fixture users live in Cairo; the device zone sync then changes nothing.
    timezoneId: "Africa/Cairo",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: [
    {
      command: "node e2e/support/paymob-double.mjs",
      url: "http://127.0.0.1:4010/health",
      reuseExistingServer: true,
    },
    // The real OpenWA gateway (zarabicschool/OpenWA, its own .env): the WhatsApp spec
    // talks to it. A linked phone is not needed; fixture numbers are fictional.
    ...(process.env.E2E_WHATSAPP === "off"
      ? []
      : [
          {
            command: "sh -c \"cd ../OpenWA && node dist/main\"",
            url: `${(process.env.OPENWA_URL || "http://127.0.0.1:2785").replace(/\/$/, "")}/api/health`,
            reuseExistingServer: true,
            timeout: 120_000,
          },
        ]),
    ...(process.env.E2E_BASE_URL
      ? []
      : [
          {
            // The server log feeds the A09 logging checks (e2e/security/owasp-top10.spec.ts).
            command: `sh -c "${process.env.E2E_SERVER === "dev" ? "npm run dev" : "npm run start"} 2>&1 | tee e2e/.run/server.log"`,
            url: baseURL,
            reuseExistingServer: !process.env.CI,
            timeout: 180_000,
          },
        ]),
  ],
});
