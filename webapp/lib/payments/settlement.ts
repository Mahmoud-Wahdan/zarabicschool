import { prisma } from "../prisma";
import { addMonthsUtc } from "../credits/period";
import { PaymentProviderError, type VerifiedPaymentEvent } from "./types";

export async function settlePaidInvoice(event: VerifiedPaymentEvent) {
  if (!event.succeeded) return { status: "ignored" as const };
  if (!event.invoiceId) {
    throw new PaymentProviderError("The payment event is not linked to an invoice.", "INVALID_WEBHOOK", 400);
  }

  return prisma.$transaction(async (tx) => {
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