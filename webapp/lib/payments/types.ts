export type PaymentCurrency = "EGP" | "USD";

export type PaymentCheckoutInput = {
  invoiceId: string;
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
  providerReference: string;
  invoiceId?: string;
  amountMinor: bigint;
  currency: PaymentCurrency;
  succeeded: boolean;
  rawEventHash: string;
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
