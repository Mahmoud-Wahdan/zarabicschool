-- Phase 9 automatic renewal / SQL S-7 (owner OK, 2026-10-27; D44, D51-D58):
-- every paid renewal is its own invoice, linked to the billing subscription and
-- the period it pays for — at most one invoice per period and one per Paymob
-- renewal transaction. FINANCIAL tables: applied by the owner, never by the agent.
-- Existing rows stay NULL; nothing else changes. Payment-audit event types for
-- renewals come later together with S-6 (same CHECK constraint).
ALTER TABLE "invoices"
  ADD COLUMN "billing_subscription_id" UUID,
  ADD COLUMN "billing_period_start" DATE,
  ADD CONSTRAINT "invoices_billing_subscription_id_fkey"
    FOREIGN KEY ("billing_subscription_id") REFERENCES "billing_subscriptions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoices_billing_period_pair_check" CHECK (
    ("billing_subscription_id" IS NULL) = ("billing_period_start" IS NULL));

CREATE UNIQUE INDEX "invoices_one_per_billing_period_key"
  ON "invoices"("billing_subscription_id", "billing_period_start")
  WHERE "billing_subscription_id" IS NOT NULL;

CREATE UNIQUE INDEX "invoices_renewal_provider_reference_key"
  ON "invoices"("provider", "provider_reference")
  WHERE "billing_subscription_id" IS NOT NULL AND "provider_reference" IS NOT NULL;

-- D56: renew on the same day of the month as the first payment.
ALTER TABLE "billing_subscriptions"
  ADD COLUMN "billing_anchor_day" SMALLINT,
  ADD CONSTRAINT "billing_subscriptions_anchor_day_check" CHECK ("billing_anchor_day" BETWEEN 1 AND 31);

-- The Paymob plan behind each monthly plan.
ALTER TABLE "billing_plans" ADD COLUMN "provider_plan_id" VARCHAR(64);
CREATE UNIQUE INDEX "billing_plans_provider_plan_id_key"
  ON "billing_plans"("provider_plan_id") WHERE "provider_plan_id" IS NOT NULL;
