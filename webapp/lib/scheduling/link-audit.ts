import type { Prisma } from "../../generated/prisma/client";

import { prisma } from "../prisma";

let auditTableReady: boolean | null = null;
let warnedMissing = false;

/**
 * The SessionLinkAudits table arrives with migration 20261012000000_phase4_link_audit,
 * which the OWNER applies (Phase 3 pattern). Until then, link edits still work and the
 * audit write is skipped with one visible warning; the audit tests self-skip the same way.
 */
export async function isLinkAuditReady(): Promise<boolean> {
  if (auditTableReady === true) return true;
  // information_schema instead of to_regclass — the regclass OID column
  // intermittently fails to deserialize through the transaction-mode pooler
  // (see lib/scheduling/session-requests.ts).
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'session_link_audits'",
  )) as { count: number }[];
  auditTableReady = rows[0]?.count === 1;
  if (!auditTableReady && !warnedMissing) {
    warnedMissing = true;
    console.warn(
      "[link-audit] session_link_audits is not applied yet (migration 20261012000000_phase4_link_audit) — link-change audit rows are skipped until the owner applies it.",
    );
  }
  return auditTableReady;
}

export type LinkAuditInput = {
  academyId: string;
  changedById: string;
  source: "SESSION" | "SERIES";
  joinUrlChanged: boolean;
  hostUrlChanged: boolean;
  seriesId?: string | null;
  sessionId?: string | null;
};

/**
 * Write one append-by-code audit row for a Zoom link change. The URL value is NEVER
 * passed in and NEVER stored — only which link kind changed, by whom, and when.
 */
export async function writeLinkAudit(tx: Prisma.TransactionClient, input: LinkAuditInput) {
  if (!(await isLinkAuditReady())) return;
  await tx.sessionLinkAudit.create({
    data: {
      academyId: input.academyId,
      changedById: input.changedById,
      source: input.source,
      joinUrlChanged: input.joinUrlChanged,
      hostUrlChanged: input.hostUrlChanged,
      seriesId: input.seriesId ?? null,
      sessionId: input.sessionId ?? null,
    },
  });
}
