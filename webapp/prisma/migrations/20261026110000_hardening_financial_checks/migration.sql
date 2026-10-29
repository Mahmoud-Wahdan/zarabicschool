-- Session 5 schema hardening on financial/attendance tables — owner-approved
-- items H1-H7 and H9 (2026-10-25). H8 (reports status CHECK) SKIPPED: the code
-- never writes ARCHIVED, so the proposed rule conflicts. H10 skipped by the owner.
-- Per-type rules are implications ("type <> X OR condition") so future entry
-- types (PLAN_GRANT, other adjustments) are not rejected.

-- H1 invoices: no impossible invoices; PAID <=> paid_at.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_amount_positive_check" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "invoices_sessions_positive_check" CHECK ("sessions_purchased" > 0),
  ADD CONSTRAINT "invoices_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "invoices_exchange_rate_positive_check" CHECK ("exchange_rate" IS NULL OR "exchange_rate" > 0),
  ADD CONSTRAINT "invoices_paid_at_consistency_check" CHECK (("status" = 'PAID') = ("paid_at" IS NOT NULL));

-- H2 invoices: student/guardian invoice lists.
CREATE INDEX "invoices_student_created_idx" ON "invoices"("student_id", "created_at");

-- H3 subscriptions.
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_sessions_nonnegative_check" CHECK ("sessions_purchased" >= 0),
  ADD CONSTRAINT "subscriptions_amount_nonnegative_check" CHECK ("total_amount_minor" >= 0),
  ADD CONSTRAINT "subscriptions_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "subscriptions_period_order_check" CHECK (
    "period_starts_at" IS NULL OR "period_ends_at" IS NULL OR "period_ends_at" > "period_starts_at"
  );

-- H4 subscription_ledger: sign/traceability per entry type.
ALTER TABLE "subscription_ledger"
  ADD CONSTRAINT "subscription_ledger_initial_purchase_check" CHECK (
    "entry_type" <> 'INITIAL_PURCHASE' OR ("sessions_delta" > 0 AND "invoice_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "subscription_ledger_session_deduction_check" CHECK (
    "entry_type" <> 'SESSION_DEDUCTION' OR ("sessions_delta" = -1 AND "session_id" IS NOT NULL AND "report_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "subscription_ledger_expiry_check" CHECK ("entry_type" <> 'EXPIRY' OR "sessions_delta" < 0),
  ADD CONSTRAINT "subscription_ledger_refund_check" CHECK ("entry_type" <> 'REFUND' OR "sessions_delta" < 0),
  ADD CONSTRAINT "subscription_ledger_adjustment_check" CHECK ("entry_type" <> 'ADMIN_ADJUSTMENT' OR "sessions_delta" <> 0);

-- H5 one INITIAL_PURCHASE per invoice (a duplicate webhook can never credit twice).
CREATE UNIQUE INDEX "subscription_ledger_one_purchase_per_invoice_key"
ON "subscription_ledger"("invoice_id") WHERE "entry_type" = 'INITIAL_PURCHASE';

-- H6 payroll_ledger: every session credit is traceable; ISO currency.
ALTER TABLE "payroll_ledger"
  ADD CONSTRAINT "payroll_ledger_credit_traceability_check" CHECK (
    "entry_type" <> 'SESSION_CREDIT'
    OR ("session_id" IS NOT NULL AND "report_id" IS NOT NULL AND "teacher_rate_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "payroll_ledger_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$');

-- H7 teacher_rates: one rate per teacher per effective instant. Currency is NOT
-- part of the key: CONTEXT §7 item 9 = one currency per teacher.
CREATE UNIQUE INDEX "teacher_rates_teacher_effective_from_key" ON "teacher_rates"("teacher_id", "effective_from");
ALTER TABLE "teacher_rates"
  ADD CONSTRAINT "teacher_rates_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$');

-- H9 sessions: Zoom links are https only (code enforces it in validateZoomUrl).
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_zoom_join_https_check" CHECK ("zoom_join_url" LIKE 'https://%'),
  ADD CONSTRAINT "sessions_zoom_host_https_check" CHECK (
    "zoom_host_url" IS NULL OR "zoom_host_url" = '' OR "zoom_host_url" LIKE 'https://%'
  );
