import "server-only";

import { Prisma } from "../../generated/prisma/client";

import { writePaymentAudit } from "../payments/audit";
import { PaymobSubscriptionClient } from "../payments/paymob-subscriptions";
import { PaymentProviderError } from "../payments/types";
import { prisma } from "../prisma";
import { linkApprovedRequest, lockOpenRequest } from "./refund-requests";

/**
 * Admin partial refund (S-13 c; D19, D42; SQL S-6, owner OK 2026-10-28).
 *
 * By sessions: amount = floor(sessions × invoice amount ÷ sessions bought). Limited by
 * the package's unreserved remaining credit (balance − RESERVED − sessions of refunds
 * still PENDING) and by (amount paid − non-FAILED refunds so far). The refund row is
 * written PENDING (with REFUND_REQUESTED) under the invoice lock BEFORE the Paymob
 * call, then finished ONCE: SUCCEEDED writes the REFUND ledger row (−sessions) and
 * REFUNDED; FAILED writes REFUND_FAILED; a provider PENDING stays visible to the
 * Admin. A crash leaves it PENDING, and the idempotency key prevents a silent double
 * refund. Teacher pay is never touched. Ids and codes only in audit metadata.
 */
export type RefundClient = Pick<PaymobSubscriptionClient, "refundTransaction">;

export type RefundResult =
  | { ok: true; status: 201 | 200 | 202; refund: { id: string; status: string; sessionsRefunded: number; amountMinor: string } }
  | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): RefundResult => ({ ok: false, status, code, message });
const view = (row: { id: string; status: string; sessionsRefunded: number; amountMinor: bigint }) => ({ id: row.id, status: row.status, sessionsRefunded: row.sessionsRefunded, amountMinor: row.amountMinor.toString() });

export function refundAmount(sessions: number, invoiceAmountMinor: bigint, sessionsPurchased: number): bigint {
  return (BigInt(sessions) * invoiceAmountMinor) / BigInt(sessionsPurchased);
}

class RefundRefusal extends Error {
  constructor(readonly result: RefundResult) {
    super("refund refused");
  }
}

export async function requestRefund(
  input: { adminId: string; academyId: string; invoiceId: string; sessions: number; reason: string; idempotencyKey: string; refundRequestId?: string },
  client: RefundClient = new PaymobSubscriptionClient(),
): Promise<RefundResult> {
  let pending: { id: string; amountMinor: bigint; transactionId: string; subscriptionId: string };
  try {
    pending = await prisma.$transaction(async (tx) => {
      const existing = await tx.invoiceRefund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        if (existing.invoiceId === input.invoiceId && existing.sessionsRefunded === input.sessions) {
          throw new RefundRefusal({ ok: true, status: 200, refund: view(existing) });
        }
        throw new RefundRefusal(fail(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different refund."));
      }
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${input.invoiceId}::uuid FOR UPDATE`;
      // S-15: a refund answering a payer's request must match an OPEN request for this invoice.
      if (input.refundRequestId && !(await lockOpenRequest(tx, input.refundRequestId, input.invoiceId, input.academyId))) {
        throw new RefundRefusal(fail(409, "REQUEST_NOT_OPEN", "This refund request is not open for this invoice."));
      }
      const invoice = await tx.invoice.findFirst({
        where: { id: input.invoiceId, academyId: input.academyId },
        select: { id: true, status: true, provider: true, amountMinor: true, currency: true, sessionsPurchased: true, providerReference: true, subscriptionId: true },
      });
      if (!invoice) throw new RefundRefusal(fail(404, "NOT_FOUND", "Invoice was not found."));
      if (invoice.status !== "PAID") throw new RefundRefusal(fail(409, "INVOICE_NOT_PAID", "Only a paid invoice can be refunded."));
      if (invoice.provider !== "PAYMOB" || !invoice.providerReference || !/^\d{1,20}$/.test(invoice.providerReference) || !invoice.subscriptionId || invoice.sessionsPurchased <= 0) {
        throw new RefundRefusal(fail(409, "NOT_REFUNDABLE", "This invoice has no Paymob transaction to refund."));
      }
      const amountMinor = refundAmount(input.sessions, invoice.amountMinor, invoice.sessionsPurchased);
      if (amountMinor <= BigInt(0)) throw new RefundRefusal(fail(400, "VALIDATION_ERROR", "The refund amount would be zero."));

      await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${invoice.subscriptionId}::uuid FOR UPDATE`;
      const [balance, reserved, earlier] = await Promise.all([
        tx.subscriptionLedger.aggregate({ where: { subscriptionId: invoice.subscriptionId }, _sum: { sessionsDelta: true } }),
        tx.sessionReservation.count({ where: { subscriptionId: invoice.subscriptionId, status: "RESERVED" } }),
        tx.invoiceRefund.findMany({ where: { invoiceId: invoice.id, status: { not: "FAILED" } }, select: { status: true, sessionsRefunded: true, amountMinor: true } }),
      ]);
      const pendingSessions = earlier.filter((row) => row.status === "PENDING").reduce((sum, row) => sum + row.sessionsRefunded, 0);
      const available = (balance._sum.sessionsDelta ?? 0) - reserved - pendingSessions;
      if (input.sessions > available) {
        throw new RefundRefusal(fail(409, "NOT_ENOUGH_CREDIT", "The package does not have that many unreserved sessions left."));
      }
      const refunded = earlier.reduce((sum, row) => sum + row.amountMinor, BigInt(0));
      if (refunded + amountMinor > invoice.amountMinor) {
        throw new RefundRefusal(fail(409, "REFUND_EXCEEDS_PAID", "Refunds cannot exceed the amount paid."));
      }
      const row = await tx.invoiceRefund.create({
        data: {
          academyId: input.academyId, invoiceId: invoice.id, sessionsRefunded: input.sessions, amountMinor, currency: invoice.currency,
          reason: input.reason, status: "PENDING", idempotencyKey: input.idempotencyKey, createdById: input.adminId,
        },
      });
      await writePaymentAudit({ academyId: input.academyId, invoiceId: invoice.id, eventType: "REFUND_REQUESTED", actorId: input.adminId, actorRole: "ADMIN", metadata: { provider: "PAYMOB", amountMinor: amountMinor.toString(), currency: invoice.currency, reason: "ADMIN_REFUND" } }, tx);
      return { id: row.id, amountMinor, transactionId: invoice.providerReference, subscriptionId: invoice.subscriptionId };
    });
  } catch (cause) {
    if (cause instanceof RefundRefusal) return cause.result;
    // A concurrent request with the same key won the insert: answer with its row.
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      const raced = await prisma.invoiceRefund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (raced) return { ok: true, status: 200, refund: view(raced) };
    }
    throw cause;
  }

  let answer: Awaited<ReturnType<RefundClient["refundTransaction"]>>;
  try {
    answer = await client.refundTransaction(pending.transactionId, pending.amountMinor);
  } catch (cause) {
    if (!(cause instanceof PaymentProviderError)) throw cause;
    answer = { providerRefundId: "", outcome: "FAILED" };
  }

  const now = new Date();
  if (answer.outcome === "PENDING") {
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.invoiceRefund.update({ where: { id: pending.id }, data: { providerRefundId: answer.providerRefundId || null } });
      if (input.refundRequestId) await linkApprovedRequest(tx, { requestId: input.refundRequestId, invoiceRefundId: updated.id, adminId: input.adminId, academyId: input.academyId, amountMinor: updated.amountMinor, currency: updated.currency });
      return updated;
    });
    return { ok: true, status: 202, refund: view(row) };
  }
  if (answer.outcome === "FAILED") {
    await prisma.$transaction(async (tx) => {
      await tx.invoiceRefund.update({ where: { id: pending.id }, data: { status: "FAILED", completedAt: now, providerRefundId: answer.providerRefundId || null } });
      await writePaymentAudit({ academyId: input.academyId, invoiceId: input.invoiceId, eventType: "REFUND_FAILED", actorId: input.adminId, actorRole: "ADMIN", metadata: { provider: "PAYMOB", reason: "PROVIDER_REFUSED" } }, tx);
    });
    return fail(502, "REFUND_FAILED", "Paymob did not accept the refund. Nothing changed.");
  }
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.invoiceRefund.update({ where: { id: pending.id }, data: { status: "SUCCEEDED", completedAt: now, providerRefundId: answer.providerRefundId } });
    await tx.subscriptionLedger.create({
      data: { academyId: input.academyId, subscriptionId: pending.subscriptionId, invoiceId: input.invoiceId, entryType: "REFUND", sessionsDelta: -updated.sessionsRefunded },
    });
    // A session deducted between the request and Paymob's answer could leave the
    // package below zero: the money already left, so the entry stands and the Admin is told.
    const balance = await tx.subscriptionLedger.aggregate({ where: { subscriptionId: pending.subscriptionId }, _sum: { sessionsDelta: true } });
    if ((balance._sum.sessionsDelta ?? 0) < 0) {
      const admins = await tx.user.findMany({ where: { academyId: input.academyId, role: "ADMIN", isActive: true }, select: { id: true } });
      await tx.notificationJob.createMany({
        data: admins.map((admin) => ({ academyId: input.academyId, sessionId: null, recipientUserId: admin.id, kind: "PAYMENT_ANOMALY", dedupKey: `PAYMENT_ANOMALY:REFUND_NEGATIVE:${pending.id}:${admin.id}`, scheduledFor: now, payload: { reason: "REFUND_LEFT_NEGATIVE_BALANCE", invoiceId: input.invoiceId } })),
        skipDuplicates: true,
      });
    }
    if (input.refundRequestId) await linkApprovedRequest(tx, { requestId: input.refundRequestId, invoiceRefundId: updated.id, adminId: input.adminId, academyId: input.academyId, amountMinor: updated.amountMinor, currency: updated.currency });
    await writePaymentAudit({ academyId: input.academyId, invoiceId: input.invoiceId, eventType: "REFUNDED", actorId: input.adminId, actorRole: "ADMIN", metadata: { provider: "PAYMOB", providerReference: answer.providerRefundId, amountMinor: updated.amountMinor.toString(), currency: updated.currency, reason: "ADMIN_REFUND" } }, tx);
    return updated;
  });
  return { ok: true, status: 201, refund: view(row) };
}
