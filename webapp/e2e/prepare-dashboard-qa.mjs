import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import pg from "pg";

// A fresh local database is required. Never reset an existing database or import .env credentials.
const url = new URL(process.env.QA_DATABASE_URL ?? "");
if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  || !/^\/zarabic_qa[a-z0-9_]*$/.test(url.pathname) || url.search || url.hash) {
  throw new Error("QA_DATABASE_URL must point directly to a local PostgreSQL database named zarabic_qa*.");
}
const client = new pg.Client({ connectionString: url.href });
await client.connect();
try {
  const { rows } = await client.query("select count(*)::int as count from information_schema.tables where table_schema='public'");
  if (rows[0].count) throw new Error("Choose an empty local QA database.");
} finally {
  await client.end();
}
const secret = () => randomBytes(32).toString("hex");
const settings = {
  DATABASE_URL: url.href, DIRECT_URL: url.href, WORKER_MODE: "separate",
  NEXTAUTH_URL: "http://127.0.0.1:3037", NEXTAUTH_SECRET: secret(),
  SEED_ADMIN_USERNAME: "qa_admin", SEED_ADMIN_NAME: "Academy QA",
  SEED_ADMIN_PASSWORD: secret(), SEED_DEMO_PASSWORD: secret(), QA_ADMIN_PASSWORD: secret(),
  SEED_TEST_PHONE_GUARDIAN: "+12025550101", SEED_TEST_PHONE_TEACHER: "+12025550102",
  SEED_SITE_WHATSAPP_NUMBER: "", OPENWA_URL: "http://127.0.0.1:9", OPENWA_API_KEY: "",
  PAYMOB_API_URL: "http://127.0.0.1:9", PAYMOB_API_KEY: "", APP_PUBLIC_URL: "http://127.0.0.1:3037",
};
mkdirSync("e2e/.run", { recursive: true });
const env = { ...process.env, ...settings };
for (const args of [["node_modules/prisma/build/index.js", "migrate", "deploy"], ["--import", "tsx", "prisma/seed-demo.ts"]]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.status !== 0) throw new Error("Local dashboard fixture setup failed.");
}
writeFileSync("e2e/.run/dashboard-env.json", JSON.stringify(settings), { mode: 0o600 });
