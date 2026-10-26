-- Phase 6 slice A5 (P13): client idempotency key for Admin payroll adjustments and
-- disbursements. A retried POST with the same Idempotency-Key header returns the
-- existing row instead of writing a second one. NULL for system rows and old rows.
-- Adding a nullable column does not fire the append-only row trigger.

ALTER TABLE "payroll_ledger" ADD COLUMN "idempotency_key" UUID;

CREATE UNIQUE INDEX "payroll_ledger_idempotency_key_key"
  ON "payroll_ledger"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
