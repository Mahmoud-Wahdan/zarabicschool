import "server-only";

import { canActOnStudentFinance } from "../guards/finance-access";
import { prisma } from "../prisma";

/**
 * Paymob return page (D19a, owner 2026-10-27) — DISPLAY ONLY. The browser return
 * never settles anything: settlement happens only in the signed webhook. Of the
 * query string we read ONE value, `order` (the Paymob order id), and use it purely
 * as a lookup key into `payment_attempts.provider_order_id`; `success`, amounts,
 * `merchant_order_id`, `hmac` and everything else are ignored. The state shown is
 * what the database says. Missing/garbled/unknown orders and any viewer who is not
 * allowed to check out the invoice (the same finance wall as checkout) all get the
 * same generic answer, so the page never confirms that an order exists.
 */

export type PaymentReturnState = "PAID" | "PROCESSING" | "DECLINED" | "FAILED" | "CANCELLED";

export type PaymentReturnView =
  | { kind: "generic" }
  | {
      kind: "invoice";
      invoiceId: string;
      state: PaymentReturnState;
      amountMinor: string;
      currency: string;
    };

type Viewer = { id: string; role: string; academyId: string } | null;

const ORDER_ID_PATTERN = /^\d{1,20}$/;
const GENERIC: PaymentReturnView = { kind: "generic" };

export async function getPaymentReturnView(
  viewer: Viewer,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<PaymentReturnView> {
  if (!viewer) return GENERIC;
  const order = searchParams.order;
  if (typeof order !== "string" || !ORDER_ID_PATTERN.test(order)) return GENERIC;

  const attempt = await prisma.paymentAttempt.findFirst({
    where: { provider: "PAYMOB", providerOrderId: order },
    select: {
      createdAt: true,
      invoice: {
        select: {
          id: true,
          academyId: true,
          status: true,
          amountMinor: true,
          currency: true,
          student: { select: { userId: true, guardianId: true, isAdult: true, guardian: { select: { userId: true } } } },
        },
      },
    },
  });
  const invoice = attempt?.invoice;
  if (!attempt || !invoice || invoice.academyId !== viewer.academyId) return GENERIC;
  if (!canActOnStudentFinance(viewer, invoice.student)) return GENERIC;

  let state: PaymentReturnState;
  if (invoice.status === "PAID") state = "PAID";
  else if (invoice.status === "CANCELLED") state = "CANCELLED";
  else if (invoice.status === "FAILED") state = "FAILED";
  else {
    // PENDING: a signed non-success callback (decline/void) for this invoice since
    // this attempt started is recorded by the webhook as a FAILED audit row.
    const declined = await prisma.paymentAudit.count({
      where: { invoiceId: invoice.id, eventType: "FAILED", actorRole: "WEBHOOK", createdAt: { gte: attempt.createdAt } },
    });
    state = declined > 0 ? "DECLINED" : "PROCESSING";
  }

  return {
    kind: "invoice",
    invoiceId: invoice.id,
    state,
    amountMinor: invoice.amountMinor.toString(),
    currency: invoice.currency,
  };
}
