-- Phase 6 slice A1 (P1/P3/P12): match a Paymob callback to its invoice through the
-- Paymob ORDER id (an HMAC-covered field), never through merchant_order_id (not in
-- the HMAC). The order id is stored on the attempt at checkout; the transaction id
-- is stored when a success settles it. Additive; existing rows keep NULLs (no real
-- payments yet; the 4 seeded attempts are manual-style SUCCEEDED rows).

ALTER TABLE "payment_attempts" ADD COLUMN "provider_order_id" VARCHAR(64);
ALTER TABLE "payment_attempts" ADD COLUMN "provider_transaction_id" VARCHAR(64);

-- One attempt per provider order: a callback resolves to exactly one invoice.
CREATE UNIQUE INDEX "payment_attempts_provider_order_key"
  ON "payment_attempts"("provider", "provider_order_id")
  WHERE "provider_order_id" IS NOT NULL;

-- One attempt per provider transaction: a transaction can settle only once.
CREATE UNIQUE INDEX "payment_attempts_provider_transaction_key"
  ON "payment_attempts"("provider", "provider_transaction_id")
  WHERE "provider_transaction_id" IS NOT NULL;
