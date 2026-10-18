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
  try {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT to_regclass('report_attachments') AS regclass",
    )) as { regclass: string | null }[];
    attachmentsTableReady = Boolean(rows[0]?.regclass);
  } catch {
    attachmentsTableReady = false;
  }
  if (!attachmentsTableReady && !warnedMissing) {
    warnedMissing = true;
    console.warn(
      "[attachments] report_attachments is not applied yet (migration 20261015093512_phase5_attachments_and_settings) — attachment endpoints return ATTACHMENTS_MIGRATION_PENDING until the owner applies it.",
    );
  }
  return attachmentsTableReady;
}
