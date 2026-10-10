/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.[jt]s?(x)"],
  // The Playwright E2E suite is invoked via `npx playwright test`, never Jest.
  testPathIgnorePatterns: ["<rootDir>/__tests__/Phase3.e2e.test.ts"],
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
