import { prisma } from "../prisma";
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

    const subscription = await tx.subscription.create({
      data: {
        academyId: invoice.academyId,
        studentId: invoice.studentId,
        packageType: invoice.packageType,
        sessionsPurchased: invoice.sessionsPurchased,
        totalAmountMinor: invoice.amountMinor,
        currency: invoice.currency,
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
