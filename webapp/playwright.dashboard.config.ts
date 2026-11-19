import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

const publicOnly = process.env.QA_PUBLIC_ONLY === "1";
const baseURL = "http://127.0.0.1:3037";
const env: Record<string, string> = publicOnly ? {
  DATABASE_URL: "postgresql://127.0.0.1:9/zarabic_qa_offline",
  DIRECT_URL: "postgresql://127.0.0.1:9/zarabic_qa_offline",
  NEXTAUTH_URL: baseURL, NEXTAUTH_SECRET: randomBytes(32).toString("hex"), WORKER_MODE: "separate",
} : JSON.parse(readFileSync("e2e/.run/dashboard-env.json", "utf8"));
if (env.NEXTAUTH_URL !== baseURL || env.WORKER_MODE !== "separate" ||
    ![env.DATABASE_URL, env.DIRECT_URL].every(value => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname))) {
  throw new Error("Dashboard visual tests require the local fixture.");
}
Object.assign(process.env, env);
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["landing-navigation.spec.ts", "public-access.spec.ts", ...(publicOnly ? [] : ["dashboards.visual.ts"])],
  workers: 1,
  timeout: 150_000,
  use: { baseURL: env.NEXTAUTH_URL, timezoneId: "Africa/Cairo" },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3037",
    url: env.NEXTAUTH_URL + "/en/login", env, reuseExistingServer: false, timeout: 180_000,
  },
});
