-- Phase 9 S-13 / SQL S-6 (D6, D19, D42, D43) — FINANCIAL (payment_audit, invoices);
-- the owner approved it as shown on 2026-10-28. Text copied verbatim from
-- docs/specs/phase-09-open-questions.md (S-6).
ALTER TABLE "payment_audit" DROP CONSTRAINT "payment_audit_event_type_check";
ALTER TABLE "payment_audit" ADD CONSTRAINT "payment_audit_event_type_check" CHECK (
  "event_type" IN ('CREATED', 'PAID', 'FAILED', 'CANCELLED', 'REJECTED', 'REFUNDED',
                   'LINK_SENT', 'REFUND_REQUESTED', 'REFUND_FAILED', 'VOIDED', 'PROVIDER_REFUND_SEEN')
);

CREATE TABLE "invoice_refunds" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "sessions_refunded" INTEGER NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "provider_refund_id" VARCHAR(64),
  "idempotency_key" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "invoice_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_refunds_positive_check" CHECK ("sessions_refunded" > 0 AND "amount_minor" > 0),
  CONSTRAINT "invoice_refunds_status_check" CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT "invoice_refunds_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 5 AND 1000)
);
CREATE UNIQUE INDEX "invoice_refunds_idempotency_key_key" ON "invoice_refunds"("idempotency_key");
CREATE INDEX "invoice_refunds_invoice_idx" ON "invoice_refunds"("invoice_id");
ALTER TABLE "invoice_refunds" ADD CONSTRAINT "invoice_refunds_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_refunds" ADD CONSTRAINT "invoice_refunds_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_refunds" ADD CONSTRAINT "invoice_refunds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Status moves PENDING → SUCCEEDED/FAILED once (guarded in code under FOR UPDATE on the invoice);
-- the credit removal is a subscription_ledger REFUND row (existing type, negative sessions_delta), written only on SUCCEEDED.
-- Cumulative check (code, same transaction): SUM(amount_minor WHERE status <> 'FAILED') + new ≤ invoices.amount_minor.
