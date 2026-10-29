-- Phase 9 S-15 / SQL S-8 (D74) — payer refund request. New table only; no change to
-- any existing financial table. The owner approved it as shown on 2026-10-29. Text copied
-- verbatim from docs/specs/slices/S-15-refund-request.md.
CREATE TABLE "refund_requests" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "requested_by" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "decided_by" UUID,
  "decided_at" TIMESTAMPTZ(6),
  "rejection_reason" TEXT,
  "invoice_refund_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refund_requests_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')),
  -- A decision has its decider and time; a rejection has a reason; an approval points to the refund made.
  CONSTRAINT "refund_requests_decision_check" CHECK (
    ("status" = 'PENDING'  AND "decided_by" IS NULL AND "decided_at" IS NULL AND "rejection_reason" IS NULL AND "invoice_refund_id" IS NULL) OR
    ("status" = 'REJECTED' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND char_length(btrim("rejection_reason")) BETWEEN 2 AND 1000 AND "invoice_refund_id" IS NULL) OR
    ("status" = 'APPROVED' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND "rejection_reason" IS NULL AND "invoice_refund_id" IS NOT NULL)
  )
);
-- One open request per invoice; after a rejection a new one is allowed.
CREATE UNIQUE INDEX "refund_requests_one_open_per_invoice" ON "refund_requests"("invoice_id") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "refund_requests_invoice_refund_id_key" ON "refund_requests"("invoice_refund_id");
CREATE INDEX "refund_requests_academy_status_idx" ON "refund_requests"("academy_id", "status");
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_invoice_refund_id_fkey" FOREIGN KEY ("invoice_refund_id") REFERENCES "invoice_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
