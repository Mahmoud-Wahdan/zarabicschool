-- Phase 9 S-01 / SQL S-1b (owner OK, 2026-10-27): a manual ATTENDED attendance
-- resolution (D36a) deducts exactly like an approved report — a real
-- SESSION_DEDUCTION of -1 — but it has no report. The 2026-10-26 hardening CHECK
-- required report_id on every deduction; it now requires only the session and -1.
-- FINANCIAL table: applied by the owner, never by the agent.
-- Every deduction without a report is referenced by exactly one
-- attendance_resolutions row (lib/attendance/resolution.ts; tests ATT-01, ATT-11).
-- The unique (session_id, subscription_id) deduction index is unchanged.
ALTER TABLE "subscription_ledger"
  DROP CONSTRAINT "subscription_ledger_session_deduction_check";
ALTER TABLE "subscription_ledger"
  ADD CONSTRAINT "subscription_ledger_session_deduction_check" CHECK (
    "entry_type" <> 'SESSION_DEDUCTION' OR ("sessions_delta" = -1 AND "session_id" IS NOT NULL)
  );
