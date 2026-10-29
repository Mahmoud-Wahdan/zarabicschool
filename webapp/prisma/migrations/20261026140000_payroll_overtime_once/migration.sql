-- Phase 6 slice A3 (P6): at most ONE overtime payroll entry per report. The overtime
-- approval writes an ADMIN_ADJUSTMENT carrying report_id; manual Admin adjustments
-- never carry a report_id, so they are not affected. DB backstop for the claim +
-- ledger transaction (a double approval can never pay twice).

CREATE UNIQUE INDEX "payroll_ledger_one_overtime_per_report_key"
  ON "payroll_ledger"("report_id")
  WHERE "entry_type" = 'ADMIN_ADJUSTMENT' AND "report_id" IS NOT NULL;
