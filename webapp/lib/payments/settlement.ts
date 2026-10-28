import { Prisma } from "../../generated/prisma/client";

import { isPhase6bReady } from "../billing/readiness";
import { prisma } from "../prisma";
import { addMonthsUtc } from "../credits/period";
import { writePaymentAudit } from "./audit";
import { PaymentProviderError, type VerifiedPaymentEvent } from "./types";

/**
 * Webhook payloads are stored ONLY through an allowlist (Phase 6b security rule,
 * CONTEXT §20.4): identification + transaction outcome. Card data (source_data.pan /
 * sub_type / type), the owner field, and any customer/billing fields are NEVER
 * persisted or logged.
 */
const WEBHOOK_EVENT_SAFE_KEYS = [
  "id",
  "created_at",
  "amount_cents",
  "currency",
  "success",
  "pending",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_voided",
  "is_standalone_payment",
  "has_parent_transaction",
  "error_occured",
  "integration_id",
] as const;

function redactWebhookPayload(event: VerifiedPaymentEvent): Prisma.InputJsonValue {
  const raw = event.rawPayload;
  if (!raw) {
    return {
      providerEventId: event.providerEventId,
      providerReference: event.providerReference,
      amountMinor: String(event.amountMinor),
      currency: event.currency,
      eventType: event.eventType ?? "PAYMENT_SUCCESS",
      redacted: true,
    };
  }
  const safe: Record<string, unknown> = { redacted: true };
  for (const key of WEBHOOK_EVENT_SAFE_KEYS) {
    if (raw[key] !== undefined) safe[key] = raw[key];
  }
  const order = raw.order;
  if (order && typeof order === "object" && !Array.isArray(order)) {
    const orderRecord = order as Record<string, unknown>;
    safe.order = {
      ...(orderRecord.id !== undefined ? { id: orderRecord.id } : {}),
      ...(orderRecord.merchant_order_id !== undefined ? { merchant_order_id: orderRecord.merchant_order_id } : {}),
    };
  }
  return safe as Prisma.InputJsonValue;
}

function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002";
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Admin-only anomaly flag (A1/P11): a signed event that needs a human look but must
 * never move money — amount/currency mismatch, a success for an invoice that is
 * already PAID (a second payment), a void/refund of a PAID invoice, a payment for a
 * disabled plan. One job per Admin, deduped per event. Ids/codes only (no amounts).
 */
async function enqueuePaymentAnomaly(db: Db, academyId: string, event: VerifiedPaymentEvent, reason: string, invoiceId: string | null) {
  const admins = await db.user.findMany({ where: { academyId, role: "ADMIN", isActive: true }, select: { id: true } });
  if (!admins.length) return;
  await db.notificationJob.createMany({
    data: admins.map((admin) => ({
      academyId,
      sessionId: null,
      recipientUserId: admin.id,
      kind: "PAYMENT_ANOMALY",
      dedupKey: `PAYMENT_ANOMALY:${event.provider}:${event.providerEventId}:${admin.id}`,
      scheduledFor: new Date(),
      payload: { reason, ...(invoiceId ? { invoiceId } : {}) },
    })),
    skipDuplicates: true,
  });
}

/**
 * The invoice a signed event belongs to (A1 rule 2): through the provider ORDER id
 * stored on our payment attempt at checkout — an HMAC-covered value. Never through
 * merchant_order_id. Events without an order id (a future USD gateway) fall back to
 * their own verified invoice id.
 */
async function resolveInvoiceId(db: Db, event: VerifiedPaymentEvent): Promise<string | null> {
  if (event.providerOrderId) {
    const attempt = await db.paymentAttempt.findFirst({
      where: { provider: event.provider, providerOrderId: event.providerOrderId },
      select: { invoiceId: true },
    });
    return attempt?.invoiceId ?? null;
  }
  return event.provider === "PAYMOB" ? null : event.invoiceId ?? null;
}

/**
 * Records a signed event that must NOT move money (a failed/pending/voided/refunded
 * payment, or one that is not linkable to an invoice) so it stays observable for
 * the Admin. Idempotent per (provider, provider_event_id); never throws —
 * observability bookkeeping must not change the webhook outcome.
 */
async function recordIgnoredWebhookEvent(event: VerifiedPaymentEvent, status: "IGNORED" | "UNMATCHED", invoiceId: string | null): Promise<void> {
  try {
    if (!(await isPhase6bReady())) return;
    await prisma.webhookEvent.create({
      data: {
        provider: event.provider,
        // An UNMATCHED success must not occupy the bare transaction id: that is the
        // settlement claim key, and a later delivery (after the order is linked) must
        // still be able to settle. Non-success ids are already "<txn>:<OUTCOME>".
        providerEventId: status === "UNMATCHED" && event.succeeded ? `${event.providerEventId}:UNMATCHED` : event.providerEventId,
        eventType: event.eventType ?? "PAYMENT_FAILED",
        payload: redactWebhookPayload(event),
        status,
      },
    });
    // Payment audit (Session 3, Slice A): a signed non-success event is a FAILED
    // payment-fact — best-effort. The audit table requires an academy: resolved
    // from the invoice; UNMATCHED events stay observable in webhook_events only.
    if (invoiceId) {
      const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { academyId: true, status: true } });
      if (invoice) {
        await writePaymentAudit(
          {
            academyId: invoice.academyId,
            invoiceId,
            // S-13 (b) / D43: a void or refund seen at the provider is recorded as such.
            eventType: event.outcome === "VOIDED" ? "VOIDED" : event.outcome === "REFUNDED" ? "PROVIDER_REFUND_SEEN" : "FAILED",
            actorId: null,
            actorRole: "WEBHOOK",
            metadata: {
              provider: event.provider,
              providerReference: event.providerReference,
              webhookStatus: status,
              reason: event.outcome ?? "FAILED",
            },
            bestEffort: true,
          },
        );
        // P11: a void/refund of an invoice we already marked PAID needs the Admin.
        // Refund handling itself waits for the refund rules (OPEN) — no money moves.
        if (invoice.status === "PAID" && (event.outcome === "VOIDED" || event.outcome === "REFUNDED")) {
          await enqueuePaymentAnomaly(prisma, invoice.academyId, event, `PAID_INVOICE_${event.outcome}`, invoiceId);
        }
      }
    }
  } catch (cause) {
    if (isUniqueViolation(cause)) return;
    // Names/ids only — never the payload — so a broken observability write can
    // never leak sensitive data into logs.
    console.error(`[webhook] could not record ${status} event ${event.providerEventId}.`);
  }
}

/**
 * A signed callback with an unexpected shape (PaymobSignedShapeError): stored once per
 * raw body as INVALID_SHAPE (field names only) so it is visible, never retried
 * forever, and never moves money. Never throws.
 */
export async function recordInvalidSignedEvent(provider: "PAYMOB", rawEventHash: string, fieldNames: string[]): Promise<void> {
  try {
    if (!(await isPhase6bReady())) return;
    await prisma.webhookEvent.create({
      data: {
        provider,
        providerEventId: `invalid:${rawEventHash}`,
        eventType: "INVALID_SHAPE",
        payload: { redacted: true, invalidFields: fieldNames.slice(0, 20) },
        status: "INVALID_SHAPE",
      },
    });
  } catch (cause) {
    if (isUniqueViolation(cause)) return;
    console.error("[webhook] could not record an INVALID_SHAPE event.");
  }
}

export type SettlementResult =
  | { status: "ignored" | "unmatched" | "already_processed" }
  | { status: "already_settled" | "mismatch" | "not_payable"; invoiceId: string }
  | { status: "settled"; invoiceId: string; subscriptionId: string };

/**
 * Signed provider event → invoice (A1). Everything signed answers 200 with a status
 * (Paymob must not retry forever); only a DB failure throws (→ 500 → provider retry,
 * idempotent through the event claim). Money moves ONLY for a SUCCESS whose order
 * resolves to a PENDING invoice with exactly the invoice's provider, amount and
 * currency.
 */
export async function settlePaidInvoice(event: VerifiedPaymentEvent): Promise<SettlementResult> {
  const invoiceId = await resolveInvoiceId(prisma, event);
  if (!event.succeeded) {
    // A signed non-success event (declined, pending 3-DS step, void, refund) never
    // touches the invoice; it is only recorded for observability.
    await recordIgnoredWebhookEvent(event, "IGNORED", invoiceId);
    return { status: "ignored" };
  }
  if (!invoiceId) {
    // Signed but not linkable to one of our payment attempts: recorded, no money.
    await recordIgnoredWebhookEvent(event, "UNMATCHED", null);
    return { status: "unmatched" };
  }

  const eventsReady = await isPhase6bReady();

  return prisma.$transaction(async (tx): Promise<SettlementResult> => {
    // CLAIM the event first (UNIQUE(provider, provider_event_id) — CONTEXT §20.4):
    // a replay or a concurrent delivery of the SAME event answers
    // "already processed" here and never reaches the invoice. The claim, the
    // invoice transition, and the ledger entry are ONE transaction — if anything
    // below fails, the claim rolls back with it, so a provider retry processes
    // the event cleanly instead of being wrongly marked complete.
    let claimId: string | null = null;
    if (eventsReady) {
      try {
        const claim = await tx.webhookEvent.create({
          data: {
            provider: event.provider,
            providerEventId: event.providerEventId,
            eventType: event.eventType ?? "PAYMENT_SUCCESS",
            payload: redactWebhookPayload(event),
            status: "PROCESSED",
          },
          select: { id: true },
        });
        claimId = claim.id;
      } catch (cause) {
        if (isUniqueViolation(cause)) {
          return { status: "already_processed" };
        }
        throw cause;
      }
    }
    // A non-settling outcome keeps the claim (so a replay stays "already processed")
    // but labels it for the Admin.
    const markClaim = async (status: "MISMATCH" | "NOT_PAYABLE" | "DUPLICATE_PAYMENT") => {
      if (claimId) await tx.webhookEvent.update({ where: { id: claimId }, data: { status }, select: { id: true } });
    };

    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        studentId: true,
        academyId: true,
        amountMinor: true,
        currency: true,
        provider: true,
        packageType: true,
        sessionsPurchased: true,
        status: true,
      },
    });
    if (!invoice) {
      // The attempt points at an invoice that no longer exists (FK RESTRICT makes
      // this unreachable); treat as a server fault so the provider retries.
      throw new PaymentProviderError("Invoice was not found.", "INVALID_WEBHOOK", 500);
    }
    // Non-settling outcomes leave an audit row (A1 rule 5) — the Admin flag points
    // to the payments audit page. Written in this transaction: if it fails, the whole
    // event rolls back and the provider retries (fail-closed, like the PAID row).
    const auditRefusal = (reason: string) =>
      writePaymentAudit({
        academyId: invoice.academyId,
        invoiceId: invoice.id,
        eventType: "FAILED",
        actorId: null,
        actorRole: "WEBHOOK",
        metadata: { provider: event.provider, providerReference: event.providerReference, reason },
      }, tx);
    if (invoice.status === "PAID") {
      // A DIFFERENT successful transaction for an invoice already paid (the same
      // transaction is stopped by the claim above): a double payment — Admin flag.
      await markClaim("DUPLICATE_PAYMENT");
      await auditRefusal("SUCCESS_ON_PAID_INVOICE");
      await enqueuePaymentAnomaly(tx, invoice.academyId, event, "SUCCESS_ON_PAID_INVOICE", invoice.id);
      return { status: "already_settled", invoiceId: invoice.id };
    }
    if (invoice.status !== "PENDING") {
      await markClaim("NOT_PAYABLE");
      await auditRefusal("SUCCESS_ON_UNPAYABLE_INVOICE");
      await enqueuePaymentAnomaly(tx, invoice.academyId, event, "SUCCESS_ON_UNPAYABLE_INVOICE", invoice.id);
      return { status: "not_payable", invoiceId: invoice.id };
    }
    const mismatch =
      invoice.provider !== event.provider
        ? "PROVIDER_MISMATCH"
        : invoice.currency !== event.currency
          ? "CURRENCY_MISMATCH"
          : invoice.amountMinor !== event.amountMinor || invoice.amountMinor <= BigInt(0)
            ? "AMOUNT_MISMATCH"
            : invoice.packageType === "ANNUAL_PLAN"
              ? "ANNUAL_PLAN_DISABLED"
              : null;
    if (mismatch) {
      // A1 rule 3 / A4 defence in depth: recorded, Admin flag, NO money, 200.
      await markClaim("MISMATCH");
      await auditRefusal(mismatch);
      await enqueuePaymentAnomaly(tx, invoice.academyId, event, mismatch, invoice.id);
      return { status: "mismatch", invoiceId: invoice.id };
    }

    const now = new Date();
    const hasPeriod = invoice.packageType !== "PAY_PER_SESSION";
    const subscription = await tx.subscription.create({
      data: {
        academyId: invoice.academyId,
        studentId: invoice.studentId,
        packageType: invoice.packageType,
        sessionsPurchased: invoice.sessionsPurchased,
        totalAmountMinor: invoice.amountMinor,
        currency: invoice.currency,
        periodStartsAt: hasPeriod ? now : null,
        periodEndsAt: hasPeriod ? addMonthsUtc(now, 1) : null,
        status: "ACTIVE",
      },
    });
    await tx.subscriptionLedger.create({
      data: {
        academyId: invoice.academyId,
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        entryType: "INITIAL_PURCHASE",
        sessionsDelta: invoice.sessionsPurchased,
      },
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "PAID",
        providerReference: event.providerReference,
        paidAt: now,
        subscriptionId: subscription.id,
      },
    });
    // The attempt that owns this order records the settling transaction; the order
    // id stays in provider_reference/provider_order_id (no more overwrite).
    if (event.providerOrderId) {
      await tx.paymentAttempt.updateMany({
        where: { provider: event.provider, providerOrderId: event.providerOrderId },
        data: { status: "SUCCEEDED", providerTransactionId: event.providerReference, rawEventHash: event.rawEventHash },
      });
    } else {
      await tx.paymentAttempt.upsert({
        where: { rawEventHash: event.rawEventHash },
        create: {
          invoiceId: invoice.id,
          provider: event.provider,
          idempotencyKey: `webhook:${event.rawEventHash}`,
          providerReference: event.providerReference,
          providerTransactionId: event.providerReference,
          status: "SUCCEEDED",
          rawEventHash: event.rawEventHash,
        },
        update: { status: "SUCCEEDED", providerTransactionId: event.providerReference },
      });
    }
    // Payment audit (Session 3, Slice A): PAID commits with the money move —
    // fail-closed; if the audit insert fails the whole settlement rolls back and
    // a provider retry reprocesses cleanly (webhook claim is in this transaction).
    await writePaymentAudit({
      academyId: invoice.academyId,
      invoiceId: invoice.id,
      eventType: "PAID",
      actorId: null,
      actorRole: "WEBHOOK",
      metadata: {
        provider: event.provider,
        providerReference: event.providerReference,
        amountMinor: invoice.amountMinor.toString(),
        currency: invoice.currency,
        packageType: invoice.packageType,
        sessionsPurchased: invoice.sessionsPurchased,
      },
    }, tx);
    return { status: "settled", invoiceId: invoice.id, subscriptionId: subscription.id };
  });
}

/**
 * Phase 6 manual-fallback confirmation: the Admin (after verifying a payment proof
 * or an external transfer) performs the SAME atomic transition as the signed
 * webhook - invoice PAID + subscription + INITIAL_PURCHASE. Never reachable by a
 * browser redirect alone; the browser return page has no such route.
 */
export async function settleInvoiceConfirmedByAdmin(options: {
  invoiceId: string;
  adminId: string;
  reference?: string;
  paymentProofId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${options.invoiceId}::uuid FOR UPDATE`;
    const invoice = await tx.invoice.findUnique({
      where: { id: options.invoiceId },
      select: {
        id: true,
        academyId: true,
        studentId: true,
        amountMinor: true,
        currency: true,
        provider: true,
        packageType: true,
        sessionsPurchased: true,
        status: true,
      },
    });
    if (!invoice) {
      throw new PaymentProviderError("Invoice was not found.", "INVALID_WEBHOOK", 404);
    }
    if (invoice.status === "PAID") return { status: "already_settled" as const, invoiceId: invoice.id };
    if (invoice.status !== "PENDING") {
      throw new PaymentProviderError("Invoice is not payable in its current state.", "INVALID_WEBHOOK", 409);
    }

    const now = new Date();
    const hasPeriod = invoice.packageType !== "PAY_PER_SESSION";
    const subscription = await tx.subscription.create({
      data: {
        academyId: invoice.academyId,
        studentId: invoice.studentId,
        packageType: invoice.packageType,
        sessionsPurchased: invoice.sessionsPurchased,
        totalAmountMinor: invoice.amountMinor,
        currency: invoice.currency,
        periodStartsAt: hasPeriod ? now : null,
        periodEndsAt: hasPeriod ? addMonthsUtc(now, 1) : null,
        status: "ACTIVE",
      },
    });
    await tx.subscriptionLedger.create({
      data: {
        academyId: invoice.academyId,
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        entryType: "INITIAL_PURCHASE",
        sessionsDelta: invoice.sessionsPurchased,
      },
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "PAID",
        providerReference: options.reference || options.paymentProofId || null,
        paidAt: now,
        subscriptionId: subscription.id,
      },
    });
    await tx.paymentAttempt.upsert({
      where: { idempotencyKey: `manual:${invoice.id}` },
      create: {
        invoiceId: invoice.id,
        provider: invoice.provider,
        idempotencyKey: `manual:${invoice.id}`,
        providerReference: options.reference || options.paymentProofId || null,
        status: "SUCCEEDED",
      },
      update: { status: "SUCCEEDED", providerReference: options.reference || options.paymentProofId || null },
    });
    if (options.paymentProofId) {
      await tx.paymentProof.updateMany({
        where: { id: options.paymentProofId, invoiceId: invoice.id, status: "PENDING" },
        data: { status: "CONFIRMED", reviewedById: options.adminId, reviewedAt: now },
      });
    }
    // Payment audit (Session 3, Slice A): PAID commits with the money move —
    // fail-closed (an audit failure aborts the admin confirmation, which is
    // idempotent: an already-paid invoice answers "already_settled").
    await writePaymentAudit({
      academyId: invoice.academyId,
      invoiceId: invoice.id,
      eventType: "PAID",
      actorId: options.adminId,
      actorRole: "ADMIN",
      metadata: {
        provider: invoice.provider,
        providerReference: options.reference || options.paymentProofId || undefined,
        amountMinor: invoice.amountMinor.toString(),
        currency: invoice.currency,
        packageType: invoice.packageType,
        sessionsPurchased: invoice.sessionsPurchased,
      },
    }, tx);
    return { status: "settled" as const, invoiceId: invoice.id, subscriptionId: subscription.id };
  });
}