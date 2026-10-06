import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  PaymentProviderError,
  type PaymentCheckout,
  type PaymentCheckoutInput,
  type PaymentProvider,
  type VerifiedPaymentEvent,
} from "./types";

type PaymobResponse = Record<string, unknown>;

const PAYMOB_HMAC_FIELDS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
] as const;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new PaymentProviderError(`Paymob is not configured: ${name} is missing.`, "NOT_CONFIGURED", 503);
  return value;
}

function asRecord(value: unknown): PaymobResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentProviderError("Paymob returned an invalid response.", "UPSTREAM_ERROR");
  }
  return value as PaymobResponse;
}

function asString(value: unknown, field: string) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new PaymentProviderError(`Paymob response is missing ${field}.`, "UPSTREAM_ERROR");
  }
  return String(value);
}

function readPath(event: PaymobResponse, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, event);
}

function hmacPayload(event: PaymobResponse) {
  return PAYMOB_HMAC_FIELDS.map((field) => String(readPath(event, field) ?? "")).join("");
}

function verifyHmac(event: PaymobResponse, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(hmacPayload(event)).digest("hex");
  const received = Buffer.from(signature.trim().toLowerCase(), "utf8");
  const calculated = Buffer.from(expected, "utf8");
  return received.length === calculated.length && timingSafeEqual(received, calculated);
}

async function postJson(url: string, body: Record<string, unknown>) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new PaymentProviderError("Could not reach Paymob.", "UPSTREAM_ERROR");
  }
  if (!response.ok) {
    throw new PaymentProviderError(`Paymob rejected the request (${response.status}).`, "UPSTREAM_ERROR");
  }
  return asRecord(await response.json());
}

export class PaymobProvider implements PaymentProvider {
  private readonly baseUrl = (process.env.PAYMOB_API_URL ?? "https://accept.paymob.com").replace(/\/$/, "");

  async createCheckout(input: PaymentCheckoutInput, idempotencyKey: string): Promise<PaymentCheckout> {
    const currency = input.currency;
    if (currency !== "EGP") {
      throw new PaymentProviderError("Paymob is configured for EGP only.", "NOT_CONFIGURED", 503);
    }
    const apiKey = requiredEnv("PAYMOB_API_KEY");
    const integrationId = requiredEnv("PAYMOB_INTEGRATION_ID_EGP");
    const iframeId = requiredEnv("PAYMOB_IFRAME_ID_EGP");
    if (input.amountMinor <= BigInt(0) || input.amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new PaymentProviderError("Invoice amount is outside Paymob's supported range.", "UPSTREAM_ERROR", 400);
    }

    const tokenResponse = await postJson(`${this.baseUrl}/api/auth/tokens`, { api_key: apiKey });
    const authToken = asString(tokenResponse.token, "token");
    const orderResponse = await postJson(`${this.baseUrl}/api/ecommerce/orders`, {
      auth_token: authToken,
      delivery_needed: false,
      amount_cents: Number(input.amountMinor),
      currency,
      merchant_order_id: input.invoiceId,
      items: [],
    });
    const orderId = asString(orderResponse.id, "order id");
    const paymentKeyResponse = await postJson(`${this.baseUrl}/api/acceptance/payment_keys`, {
      auth_token: authToken,
      amount_cents: Number(input.amountMinor),
      expiration: 3600,
      order_id: orderId,
      currency,
      integration_id: Number(integrationId),
      billing_data: {
        apartment: "NA",
        email: input.customer.email,
        floor: "NA",
        first_name: input.customer.firstName,
        street: "NA",
        building: "NA",
        phone_number: input.customer.phone,
        shipping_method: "NA",
        postal_code: "NA",
        city: "NA",
        country: "EG",
        last_name: input.customer.lastName,
        state: "NA",
      },
    });
    const paymentToken = asString(paymentKeyResponse.token, "payment token");
    return {
      providerReference: orderId,
      checkoutUrl: `${this.baseUrl}/api/acceptance/iframes/${encodeURIComponent(iframeId)}?payment_token=${encodeURIComponent(paymentToken)}`,
      idempotencyKey,
    };
  }

  verifyWebhook(rawBody: string, signature: string | null): VerifiedPaymentEvent {
    const secret = requiredEnv("PAYMOB_HMAC_SECRET");
    let parsed: PaymobResponse;
    try {
      parsed = asRecord(JSON.parse(rawBody));
    } catch {
      throw new PaymentProviderError("Paymob webhook JSON is invalid.", "INVALID_WEBHOOK", 400);
    }
    if (!verifyHmac(parsed, signature, secret)) {
      throw new PaymentProviderError("Paymob webhook signature is invalid.", "INVALID_WEBHOOK", 401);
    }
    const amountCents = Number(readPath(parsed, "amount_cents"));
    const currency = readPath(parsed, "currency");
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || currency !== "EGP") {
      throw new PaymentProviderError("Paymob webhook amount or currency is invalid.", "INVALID_WEBHOOK", 400);
    }
    const reference = String(readPath(parsed, "id") ?? "");
    if (!reference) throw new PaymentProviderError("Paymob webhook reference is missing.", "INVALID_WEBHOOK", 400);
    const merchantOrderId = readPath(parsed, "merchant_order_id") ?? readPath(parsed, "order.merchant_order_id");
    return {
      providerReference: reference,
      invoiceId: typeof merchantOrderId === "string"
        ? merchantOrderId
        : undefined,
      amountMinor: BigInt(amountCents),
      currency: "EGP",
      succeeded: readPath(parsed, "success") === true,
      rawEventHash: createHash("sha256").update(rawBody).digest("hex"),
    };
  }
}

export function buildPaymobHmacPayload(event: Record<string, unknown>) {
  return hmacPayload(event);
}
