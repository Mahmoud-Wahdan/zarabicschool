import { prisma } from "../prisma";

let attachmentsTableReady = false;
let warnedMissing = false;

/**
 * The report_attachments / academy_settings tables arrive with migration
 * 20261015093512_phase5_attachments_and_settings, which the OWNER applies
 * (Phase 3/4 pattern). Until then, attachment routes answer with a clean
 * "pending migration" conflict and the attachment tests self-deactivate the
 * same way the link-audit tests do.
 *
 * Only the POSITIVE result is cached (self-healing after the migration lands
 * — no dev-server restart needed); a negative result is re-checked per call.
 */
export async function isAttachmentsReady(): Promise<boolean> {
  if (attachmentsTableReady) return true;
  // information_schema instead of to_regclass — the regclass OID column
  // intermittently fails to deserialize through the transaction-mode pooler
  // (see lib/scheduling/session-requests.ts).
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'report_attachments'",
  )) as { count: number }[];
  attachmentsTableReady = rows[0]?.count === 1;
  if (!attachmentsTableReady && !warnedMissing) {
    warnedMissing = true;
    console.warn(
      "[attachments] report_attachments is not applied yet (migration 20261015093512_phase5_attachments_and_settings) — attachment endpoints return ATTACHMENTS_MIGRATION_PENDING until the owner applies it.",
    );
  }
  return attachmentsTableReady;
}
