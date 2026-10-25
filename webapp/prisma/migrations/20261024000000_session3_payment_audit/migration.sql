-- Session 3, slice A: append-only payment audit trail (owner decision 2026-10-24).
-- One row per payment lifecycle event. Minimal SAFE metadata only (no card data,
-- no gateway payload). CANCELLED/REFUNDED have no producers until Phase 6b — the
-- CHECK already accepts them so no migration is needed when those flows arrive.

CREATE TABLE "payment_audit" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "invoice_id" UUID,
  "event_type" VARCHAR NOT NULL,
  "actor_id" UUID,
  "actor_role" VARCHAR,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_audit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_audit_event_type_check" CHECK (
    "event_type" IN ('CREATED', 'PAID', 'FAILED', 'CANCELLED', 'REJECTED', 'REFUNDED')
  ),
  CONSTRAINT "payment_audit_actor_role_check" CHECK (
    "actor_role" IS NULL OR "actor_role" IN ('ADMIN', 'STUDENT', 'GUARDIAN', 'WEBHOOK', 'SYSTEM')
  )
);

CREATE INDEX "payment_audit_academy_id_created_at_idx" ON "payment_audit"("academy_id", "created_at" DESC);
CREATE INDEX "payment_audit_invoice_id_idx" ON "payment_audit"("invoice_id");

-- RESTRICT FKs: audit rows are history and must never cascade-delete.
ALTER TABLE "payment_audit"
  ADD CONSTRAINT "payment_audit_academy_id_fkey"
  FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_audit"
  ADD CONSTRAINT "payment_audit_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_audit"
  ADD CONSTRAINT "payment_audit_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only, exactly like the ledgers: reuses prevent_ledger_mutation()
-- (created by 20261007150000_phase3_integrity).
CREATE TRIGGER payment_audit_append_only
BEFORE UPDATE OR DELETE ON "payment_audit"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
