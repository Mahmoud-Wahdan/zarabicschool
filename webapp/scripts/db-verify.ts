/**
 * `npm run db:verify` — READ-ONLY database checks before a staging run or a release.
 * Prints check names and COUNTS only (never rows, names, phones, links or amounts) and
 * exits 1 when any check fails. Every query runs inside a READ ONLY transaction that is
 * rolled back. Uses DATABASE_URL from the process env (then `.env`, never overriding).
 *
 * Checks: migrations applied and none failed; append-only triggers and the money
 * uniqueness indexes exist; the settlement / purchase invariants hold; no test data
 * (per-run test academies, demo_test_* users) is left behind.
 */
import "dotenv/config";

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

type Check = { name: string; sql: string; expect: "zero" | "atLeastOne" | { equals: number } };

const migrationDirs = readdirSync(join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;

const triggers = [
  "subscription_ledger_append_only",
  "payroll_ledger_append_only",
  "payment_audit_append_only",
  "announcements_append_only",
  "attendance_resolutions_append_only",
  "subscription_ledger_deduction_source",
];
const moneyIndexes = [
  "payroll_ledger_one_session_credit_key",
  "payroll_ledger_one_overtime_per_report_key",
  "payroll_ledger_idempotency_key_key",
  "subscription_ledger_session_subscription_deduction_key",
  "subscription_ledger_one_purchase_per_invoice_key",
  "webhook_events_provider_provider_event_id_key",
  "invoice_refunds_idempotency_key_key",
  "reports_session_id_student_id_report_type_key",
];

const checks: Check[] = [
  { name: "migrations applied (= folders in prisma/migrations)", sql: `SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`, expect: { equals: migrationDirs } },
  { name: "failed migrations", sql: `SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`, expect: "zero" },
  ...triggers.map((name): Check => ({ name: `trigger ${name}`, sql: `SELECT count(*) FROM pg_trigger WHERE tgname = '${name}' AND NOT tgisinternal`, expect: "atLeastOne" })),
  ...moneyIndexes.map((name): Check => ({ name: `unique index ${name}`, sql: `SELECT count(*) FROM pg_indexes WHERE indexname = '${name}'`, expect: "atLeastOne" })),
  { name: "approved/archived reports without settlement", sql: `SELECT count(*) FROM reports WHERE status IN ('APPROVED', 'ARCHIVED') AND settled_at IS NULL`, expect: "zero" },
  { name: "settled ATTENDED reports whose session has no teacher credit", sql: `SELECT count(*) FROM reports r WHERE r.settled_at IS NOT NULL AND r.attendance_outcome = 'ATTENDED' AND NOT EXISTS (SELECT 1 FROM payroll_ledger p WHERE p.session_id = r.session_id AND p.entry_type = 'SESSION_CREDIT')`, expect: "zero" },
  { name: "student deductions written for an ABSENT report", sql: `SELECT count(*) FROM subscription_ledger l JOIN reports r ON r.id = l.report_id WHERE l.entry_type = 'SESSION_DEDUCTION' AND r.attendance_outcome = 'STUDENT_ABSENT'`, expect: "zero" },
  { name: "teacher credits without a settled report", sql: `SELECT count(*) FROM payroll_ledger p WHERE p.entry_type = 'SESSION_CREDIT' AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.session_id = p.session_id AND r.settled_at IS NOT NULL)`, expect: "zero" },
  { name: "PAID invoices without their INITIAL_PURCHASE", sql: `SELECT count(*) FROM invoices i WHERE i.status = 'PAID' AND NOT EXISTS (SELECT 1 FROM subscription_ledger l WHERE l.invoice_id = i.id AND l.entry_type = 'INITIAL_PURCHASE')`, expect: "zero" },
  { name: "COMPLETED sessions not fully reported", sql: `SELECT count(*) FROM sessions s WHERE s.status = 'COMPLETED' AND EXISTS (SELECT 1 FROM session_students ss WHERE ss.session_id = s.id AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.session_id = s.id AND r.student_id = ss.student_id))`, expect: "zero" },
  { name: "per-run test academies left", sql: `SELECT count(*) FROM academies WHERE name LIKE 'Zarabicschool Test %' OR name LIKE 'Zarabicschool Foreign %'`, expect: "zero" },
  { name: "demo_test_* users left", sql: `SELECT count(*) FROM users WHERE username LIKE 'demo\\_test\\_%'`, expect: "zero" },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("db:verify: DATABASE_URL is not set.");
    process.exit(2);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  let failed = 0;
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    for (const check of checks) {
      const count = Number((await client.query<{ count: string }>(check.sql)).rows[0].count);
      const ok = check.expect === "zero" ? count === 0 : check.expect === "atLeastOne" ? count > 0 : count === check.expect.equals;
      if (!ok) failed += 1;
      const expected = check.expect === "zero" ? "0" : check.expect === "atLeastOne" ? "≥1" : String(check.expect.equals);
      console.info(`${ok ? "PASS" : "FAIL"}  ${check.name}: ${count} (expected ${expected})`);
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
  console.info(failed === 0 ? `db:verify: all ${checks.length} checks passed.` : `db:verify: ${failed} of ${checks.length} checks FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
