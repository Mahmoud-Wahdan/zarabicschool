import "server-only";

import { Prisma } from "../../generated/prisma/client";

import { prisma } from "../prisma";

/**
 * Append-only payment audit writes (Session 3, owner decision 2026-10-24 —
 * docs/specs/phase-06-financial-management.md § Session 3, Slice A).
 *
 * One row per payment lifecycle event with MINIMAL SAFE metadata only: never card
 * data, never a gateway payload, never names/phones. Admin-only read surface
 * (`/api/admin/payment-audit`); the append-only UPDATE/DELETE trigger lives in the
 * migration (the ledgers' `prevent_ledger_mutation()` pattern).
 *
 * Readiness: the table arrives with migration 20261024000000 (owner applies).
 * Until then every write is skipped with a logged warning — business behavior
 * never changes and nothing crashes (the migration-pending banner shows on the
 * Admin page, the same self-healing pattern as isAttachmentsReady).
 */

export type PaymentAuditEventType = "CREATED" | "PAID" | "FAILED" | "CANCELLED" | "REJECTED" | "REFUNDED";

export type PaymentAuditActorRole = "ADMIN" | "STUDENT" | "GUARDIAN" | "WEBHOOK" | "SYSTEM";

export type PaymentAuditMetadata = {
  attemptId?: string;
  idempotencyKey?: string;
  provider?: string;
  providerReference?: string;
  amountMinor?: string;
  currency?: string;
  reason?: string;
  packageType?: string;
  sessionsPurchased?: number;
  webhookStatus?: string;
};

let paymentAuditReady: boolean | null = null;

/** True once the owner applies migration 20261024000000 (payment_audit table). */
export async function isPaymentAuditReady(): Promise<boolean> {
  if (paymentAuditReady === true) return true;
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payment_audit'",
  )) as { count: number }[];
  paymentAuditReady = rows[0]?.count === 1;
  return paymentAuditReady;
}

/** Resets the cached readiness probe (used by the Admin page banner only). */
export function resetPaymentAuditReadiness(): void {
  paymentAuditReady = null;
}

/**
 * One allowlist for audit metadata: unknown keys are dropped so a caller can never
 * smuggle gateway payloads or card fields into the audit trail.
 */
function safeMetadata(metadata: PaymentAuditMetadata | undefined): Prisma.InputJsonValue | undefined {
  if (!metadata) return undefined;
  const safe: Record<string, unknown> = {};
  for (const key of [
    "attemptId",
    "idempotencyKey",
    "provider",
    "providerReference",
    "amountMinor",
    "currency",
    "reason",
    "packageType",
    "sessionsPurchased",
    "webhookStatus",
  ] as const) {
    const value = metadata[key];
    if (value !== undefined && value !== null && value !== "") safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? (safe as Prisma.InputJsonValue) : undefined;
}

/**
 * Writes ONE audit row. When `tx` is provided the row commits with the caller's
 * transaction (fail-closed: a money move and its audit row commit or roll back
 * TOGETHER). Without `tx` the write is standalone; `standalone: true` callers that
 * are pure observability may pass `bestEffort` so a failure never changes the
 * caller's outcome.
 */
export async function writePaymentAudit(
  input: {
    academyId: string;
    invoiceId: string | null;
    eventType: PaymentAuditEventType;
    actorId: string | null;
    actorRole: PaymentAuditActorRole;
    metadata?: PaymentAuditMetadata;
    bestEffort?: boolean;
  },
  tx?: Prisma.TransactionClient,
): Promise<void> {
  if (!(await isPaymentAuditReady())) {
    if (!input.bestEffort) {
      console.warn("[payment-audit] migration 20261024000000 not applied — audit write skipped.");
    }
    return;
  }
  const data = {
    academyId: input.academyId,
    invoiceId: input.invoiceId,
    eventType: input.eventType,
    actorId: input.actorId,
    actorRole: input.actorRole,
    metadata: safeMetadata(input.metadata),
  };
  try {
    if (tx) {
      await tx.paymentAudit.create({ data });
    } else {
      await prisma.paymentAudit.create({ data });
    }
  } catch (cause) {
    if (input.bestEffort) {
      // Observability-only write: ids/events only in the log — never metadata,
      // never payloads (the audit trail must not become a leak channel itself).
      console.error(`[payment-audit] could not record ${input.eventType} event.`);
      return;
    }
    throw cause;
  }
}
