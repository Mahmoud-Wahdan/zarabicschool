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
  moduleDirectories: ["node_modules", "<rootDir>/"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
};

module.exports = createJestConfig(customJestConfig);
