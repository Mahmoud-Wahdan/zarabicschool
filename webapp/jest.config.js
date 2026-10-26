/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.[jt]s?(x)"],
  // Playwright E2E specs live in e2e/ and run via `npx playwright test` only —
  // that directory can never match the testMatch above.
  // Database-backed suites share one Supabase database; parallel workers cause
  // serializable-transaction write conflicts, so suites run sequentially.
  maxWorkers: 1,
  setupFiles: ["<rootDir>/jest.setup.js"],
  // Fake WhatsApp provider for every suite — tests never call OpenWA.
  // Longer Prisma transaction limits for tests only (remote dev DB latency);
  // the app keeps Prisma's defaults.
  setupFilesAfterEnv: [
    "<rootDir>/__tests__/helpers/fake-messaging.setup.ts",
    "<rootDir>/__tests__/helpers/db-timeouts.setup.ts",
  ],
  moduleDirectories: ["node_modules", "<rootDir>/"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
};

module.exports = createJestConfig(customJestConfig);
