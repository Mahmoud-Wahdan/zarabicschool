export type PaymentCurrency = "EGP" | "USD";

export type PaymentEventType =
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "SUBSCRIPTION_RENEWAL_SUCCESS"
  | "SUBSCRIPTION_RENEWAL_FAILED"
  | "SUBSCRIPTION_CANCELED";

/** Normalized provider outcome of one signed callback (A1). Only SUCCESS moves money. */
export type PaymentOutcome = "SUCCESS" | "PENDING" | "FAILED" | "VOIDED" | "REFUNDED";

export type PaymentCheckoutInput = {
  invoiceId: string;
  /** Unique per payment attempt (`<invoiceId>:v<n>`, always set by the checkout route);
   * informational at the provider. Falls back to the invoice id when absent. */
  merchantOrderId?: string;
  amountMinor: bigint;
  currency: PaymentCurrency;
  description: string;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
};

export type PaymentCheckout = {
  providerReference: string;
  checkoutUrl: string;
  idempotencyKey: string;
};

export type VerifiedPaymentEvent = {
  provider: "PAYMOB" | "USD_GATEWAY";
  providerEventId: string;
  providerReference: string;
  /** Provider order id (HMAC-covered) — the ONLY key used to find the invoice (A1). */
  providerOrderId?: string;
  invoiceId?: string;
  providerSubscriptionId?: string;
  amountMinor: bigint;
  currency: string;
  succeeded: boolean;
  outcome?: PaymentOutcome;
  rawEventHash: string;
  eventType?: PaymentEventType;
  eventTimestamp?: Date;
  rawPayload?: Record<string, unknown>;
};

export interface PaymentProvider {
  createCheckout(input: PaymentCheckoutInput, idempotencyKey: string): Promise<PaymentCheckout>;
  verifyWebhook(rawBody: string, signature: string | null): VerifiedPaymentEvent;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "UPSTREAM_ERROR" | "INVALID_WEBHOOK",
    readonly status = 502,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
