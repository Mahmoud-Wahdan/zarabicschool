-- Phase 9 S-12 / SQL S-5 (D14, D40) — FINANCIAL (payroll_ledger); the owner approved
-- it as shown on 2026-10-28. New Admin adjustments carry a category; existing rows stay
-- NULL (append-only; approved-overtime rows are recognized by report_id, D40).
ALTER TABLE "payroll_ledger" ADD COLUMN "adjustment_category" VARCHAR(20);
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_adjustment_category_check" CHECK (
  "adjustment_category" IS NULL
  OR ("entry_type" = 'ADMIN_ADJUSTMENT' AND "adjustment_category" IN ('BONUS', 'FINE', 'OVERTIME', 'OTHER'))
);
