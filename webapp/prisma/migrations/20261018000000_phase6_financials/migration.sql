-- Phase 6 — financial tables: teacher_rates, payroll_ledger, payment_proofs.
-- Idempotent SQL: the transaction-mode pooler runs each statement in its own
-- transaction, so a partially-applied attempt must be safely re-runnable.
-- Invariants (database-schema.md §12/§14): partial unique index for the
-- once-per-session teacher credit, sign CHECKs, append-only trigger (reuses the
-- existing prevent_ledger_mutation() function from phase3_integrity).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PayrollLedgerEntryType') THEN
    CREATE TYPE "PayrollLedgerEntryType" AS ENUM ('SESSION_CREDIT', 'ADMIN_ADJUSTMENT', 'DISBURSEMENT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentProofStatus') THEN
    CREATE TYPE "PaymentProofStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "teacher_rates" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "hourly_rate_minor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "teacher_rates_amount_check" CHECK ("hourly_rate_minor" > 0)
);

CREATE TABLE IF NOT EXISTS "payroll_ledger" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "session_id" UUID,
    "report_id" UUID,
    "teacher_rate_id" UUID,
    "entry_type" "PayrollLedgerEntryType" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "minutes_credited" INTEGER,
    "hourly_rate_snapshot_minor" INTEGER,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_ledger_credit_sign_check" CHECK ("entry_type" <> 'SESSION_CREDIT' OR "amount_minor" > 0),
    CONSTRAINT "payroll_ledger_adjustment_sign_check" CHECK ("entry_type" <> 'ADMIN_ADJUSTMENT' OR "amount_minor" <> 0),
    CONSTRAINT "payroll_ledger_disbursement_sign_check" CHECK ("entry_type" <> 'DISBURSEMENT' OR "amount_minor" < 0),
    CONSTRAINT "payroll_ledger_credit_snapshot_check" CHECK (
        "entry_type" <> 'SESSION_CREDIT'
        OR ("minutes_credited" IS NOT NULL AND "minutes_credited" > 0 AND "hourly_rate_snapshot_minor" IS NOT NULL AND "hourly_rate_snapshot_minor" > 0)
    ),
    CONSTRAINT "payroll_ledger_manual_reason_check" CHECK ("entry_type" = 'SESSION_CREDIT' OR ("reason" IS NOT NULL AND length("reason") >= 2)),
    CONSTRAINT "payroll_ledger_creator_check" CHECK ("entry_type" = 'SESSION_CREDIT' OR "created_by" IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS "payment_proofs" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "file_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "original_name" TEXT NOT NULL,
    "status" "PaymentProofStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_proofs_size_check" CHECK ("size_bytes" > 0),
    CONSTRAINT "payment_proofs_review_check" CHECK (
        ("status" IN ('PENDING') AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL)
        OR ("status" IN ('CONFIRMED', 'REJECTED') AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL)
    )
);

-- ONE teacher session credit per session (double-payment protection #3, CONTEXT §7).
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_ledger_one_session_credit_key"
  ON "payroll_ledger" ("session_id")
  WHERE "entry_type" = 'SESSION_CREDIT';

CREATE INDEX IF NOT EXISTS "teacher_rates_teacher_effective_idx" ON "teacher_rates" ("teacher_id", "effective_from");
CREATE INDEX IF NOT EXISTS "payroll_ledger_teacher_currency_idx" ON "payroll_ledger" ("teacher_id", "currency", "created_at");
CREATE INDEX IF NOT EXISTS "payroll_ledger_session_idx" ON "payroll_ledger" ("session_id");
CREATE INDEX IF NOT EXISTS "payroll_ledger_academy_created_idx" ON "payroll_ledger" ("academy_id", "created_at");
CREATE INDEX IF NOT EXISTS "payment_proofs_invoice_created_idx" ON "payment_proofs" ("invoice_id", "created_at");
CREATE INDEX IF NOT EXISTS "payment_proofs_academy_status_idx" ON "payment_proofs" ("academy_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teacher_rates_academy_fkey') THEN
    ALTER TABLE "teacher_rates" ADD CONSTRAINT "teacher_rates_academy_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teacher_rates_teacher_fkey') THEN
    ALTER TABLE "teacher_rates" ADD CONSTRAINT "teacher_rates_teacher_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teacher_rates_created_by_fkey') THEN
    ALTER TABLE "teacher_rates" ADD CONSTRAINT "teacher_rates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_ledger_academy_fkey') THEN
    ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_academy_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_ledger_teacher_fkey') THEN
    ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_teacher_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_ledger_session_fkey') THEN
    ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_session_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_ledger_report_fkey') THEN
    ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_report_fkey" FOREIGN KEY ("report_id") REFERENCES "reports" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_ledger_teacher_rate_fkey') THEN
    ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_teacher_rate_fkey" FOREIGN KEY ("teacher_rate_id") REFERENCES "teacher_rates" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_ledger_created_by_fkey') THEN
    ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_proofs_academy_fkey') THEN
    ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_academy_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_proofs_invoice_fkey') THEN
    ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_invoice_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_proofs_uploaded_by_fkey') THEN
    ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_proofs_reviewed_by_fkey') THEN
    ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- PayrollLedger is append-only (CONTEXT §7 dual ledger): UPDATE/DELETE raise.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_ledger_append_only') THEN
    CREATE TRIGGER payroll_ledger_append_only
    BEFORE UPDATE OR DELETE ON "payroll_ledger"
    FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
  END IF;
END
$$;
