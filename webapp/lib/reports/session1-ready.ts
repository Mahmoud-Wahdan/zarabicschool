import { prisma } from "../prisma";

let session1Ready = false;
let warnedMissing = false;

/**
 * Session 1 additions (owner, 2026-10-18) arrive with migration
 * 20261018190000_session1_report_languages_monthly, which the OWNER applies
 * (Phase 3/4/5 pattern): `reports.language` + `reports.rejection_count`,
 * `students.report_language`, and the `monthly_reports` table.
 *
 * The migration is one transaction, so checking a single new artifact
 * (`monthly_reports.month_key`) proves the whole migration landed. Until then:
 * - existing report flows keep working exactly as before (new columns are
 *   simply omitted from reads/writes — never a P2022 crash);
 * - monthly-report endpoints answer with a clean `MONTHLY_REPORTS_MIGRATION_PENDING` 409;
 * - the report-language selector and the rejection counter self-hide.
 *
 * Only the POSITIVE result is cached (self-healing after the migration lands
 * — no dev-server restart needed); a negative result is re-checked per call.
 * information_schema instead of to_regclass — the regclass OID column
 * intermittently fails to deserialize through the transaction-mode pooler.
 */
export async function isSession1ReportsReady(): Promise<boolean> {
  if (session1Ready) return true;
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'monthly_reports' AND column_name = 'month_key'",
  )) as { count: number }[];
  session1Ready = rows[0]?.count === 1;
  if (!session1Ready && !warnedMissing) {
    warnedMissing = true;
    console.warn(
      "[session1] migration 20261018190000_session1_report_languages_monthly is not applied yet — monthly reports return MONTHLY_REPORTS_MIGRATION_PENDING and report languages/rejection counters self-hide until the owner applies it.",
    );
  }
  return session1Ready;
}
