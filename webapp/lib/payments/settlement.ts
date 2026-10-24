import { Prisma } from "../../generated/prisma/client";

import { isPhase6bReady } from "../billing/readiness";
import { prisma } from "../prisma";
import { addMonthsUtc } from "../credits/period";
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

/**
 * Records a signed event that must NOT move money (a failed payment, or one that
 * is not linkable to an invoice) so the anomaly stays observable for the Admin.
 * Idempotent per (provider, provider_event_id); never throws — observability
 * bookkeeping must not change the webhook outcome.
 */
async function recordIgnoredWebhookEvent(event: VerifiedPaymentEvent, status: "IGNORED" | "UNMATCHED"): Promise<void> {
  try {
    if (!(await isPhase6bReady())) return;
    await prisma.webhookEvent.create({
      data: {
        provider: event.provider,
        providerEventId: event.providerEventId,
        eventType: event.eventType ?? "PAYMENT_FAILED",
        payload: redactWebhookPayload(event),
        status,
      },
    });
  } catch (cause) {
    if (isUniqueViolation(cause)) return;
    // Names/ids only — never the payload — so a broken observability write can
    // never leak sensitive data into logs.
    console.error(`[webhook] could not record ${status} event ${event.providerEventId}.`);
  }
}

export async function settlePaidInvoice(event: VerifiedPaymentEvent) {
  if (!event.succeeded) {
    // A signed non-success event (failed card payment) never touches the invoice;
    // it is only recorded for observability.
    await recordIgnoredWebhookEvent(event, "IGNORED");
    return { status: "ignored" as const };
  }
  if (!event.invoiceId) {
    // Signed but not linkable to one of our invoices (no merchant_order_id):
    // record it first (own commit), then reject the event.
    await recordIgnoredWebhookEvent(event, "UNMATCHED");
    throw new PaymentProviderError("The payment event is not linked to an invoice.", "INVALID_WEBHOOK", 400);
  }

  const eventsReady = await isPhase6bReady();

  return prisma.$transaction(async (tx) => {
    // CLAIM the event first (UNIQUE(provider, provider_event_id) — CONTEXT §20.4):
    // a replay or a concurrent delivery of the SAME event answers
    // "already processed" here and never reaches the invoice. The claim, the
    // invoice transition, and the ledger entry are ONE transaction — if anything
    // below fails, the claim rolls back with it, so a provider retry processes
    // the event cleanly instead of being wrongly marked complete. The
    // webhook_events table arrives with migration 20261020000000
    // (isPhase6bReady); before it is applied, the invoice row lock + the
    // PAID-state guard below remain the duplicate protection.
    if (eventsReady) {
      try {
        await tx.webhookEvent.create({
          data: {
            provider: event.provider,
            providerEventId: event.providerEventId,
            eventType: event.eventType ?? "PAYMENT_SUCCESS",
            payload: redactWebhookPayload(event),
            status: "PROCESSED",
          },
        });
      } catch (cause) {
        if (isUniqueViolation(cause)) {
          return { status: "already_processed" as const };
        }
        throw cause;
      }
    }
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${event.invoiceId}::uuid FOR UPDATE`;
    const invoice = await tx.invoice.findUnique({
      where: { id: event.invoiceId },
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
      throw new PaymentProviderError("Invoice was not found.", "INVALID_WEBHOOK", 404);
    }
    if (invoice.status === "PAID") return { status: "already_settled" as const, invoiceId: invoice.id };
    if (invoice.status !== "PENDING") {
      throw new PaymentProviderError("Invoice is not payable in its current state.", "INVALID_WEBHOOK", 409);
    }
    if (
      invoice.provider !== "PAYMOB" ||
      invoice.currency !== event.currency ||
      invoice.amountMinor !== event.amountMinor ||
      invoice.amountMinor <= BigInt(0)
    ) {
      throw new PaymentProviderError("Payment does not match the invoice.", "INVALID_WEBHOOK", 400);
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
        paidAt: new Date(),
        subscriptionId: subscription.id,
      },
    });
    await tx.paymentAttempt.upsert({
      where: { rawEventHash: event.rawEventHash },
      create: {
        invoiceId: invoice.id,
        provider: "PAYMOB",
        idempotencyKey: `webhook:${event.rawEventHash}`,
        providerReference: event.providerReference,
        status: "SUCCEEDED",
        rawEventHash: event.rawEventHash,
      },
      update: { status: "SUCCEEDED", providerReference: event.providerReference },
    });
    return { status: "settled" as const, invoiceId: invoice.id, subscriptionId: subscription.id };
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
    return { status: "settled" as const, invoiceId: invoice.id, subscriptionId: subscription.id };
  });
}