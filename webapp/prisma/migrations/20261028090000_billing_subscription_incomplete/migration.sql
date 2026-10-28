-- Phase 9 automatic renewal / SQL S-7b (owner OK, 2026-10-28):
-- INCOMPLETE = consent given, first payment not yet verified by Paymob. The
-- renewal worker reads only ACTIVE / PAST_DUE, so an INCOMPLETE row never renews
-- or enters grace; an abandoned sign-up becomes CANCELED (no money moved).
ALTER TYPE "BillingSubscriptionStatus" ADD VALUE IF NOT EXISTS 'INCOMPLETE';

-- At most one live automatic renewal per student.
CREATE UNIQUE INDEX "billing_subscriptions_one_live_per_student"
  ON "billing_subscriptions"("student_id")
  WHERE "status" <> 'CANCELED';
