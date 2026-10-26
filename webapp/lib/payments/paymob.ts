import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  PaymentProviderError,
  type PaymentCheckout,
  type PaymentCheckoutInput,
  type PaymentProvider,
  type PaymentOutcome,
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

/**
 * The ONE place that knows the Paymob callback envelope (A1 — keep isolated: the
 * shape is confirmed in the sandbox later, and a correction must stay a one-function
 * change). The documented "transaction processed" callback is
 * `{ "type": "TRANSACTION", "obj": { …transaction… } }` with `?hmac=` in the query;
 * a flat transaction body is also accepted. Returns the transaction object whose
 * fields the HMAC covers.
 */
export function parsePaymobCallback(rawBody: string): PaymobResponse {
  let body: PaymobResponse;
  try {
    body = asRecord(JSON.parse(rawBody));
  } catch {
    throw new PaymentProviderError("Paymob webhook JSON is invalid.", "INVALID_WEBHOOK", 400);
  }
  const envelope = body.obj;
  if (envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
    return envelope as PaymobResponse;
  }
  return body;
}

/** Signature location: the documented `?hmac=` query parameter, else an `hmac` header. */
export function readPaymobSignature(requestUrl: string, headers: Headers): string | null {
  try {
    const fromQuery = new URL(requestUrl).searchParams.get("hmac");
    if (fromQuery) return fromQuery;
  } catch {
    // fall through to the header
  }
  return headers.get("hmac");
}

// Fields the settlement decision reads — all inside the HMAC field list above.
const paymobTransactionSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().regex(/^\d{1,20}$/)]),
  success: z.boolean(),
  pending: z.boolean(),
  is_voided: z.boolean(),
  is_refunded: z.boolean(),
  is_auth: z.boolean(),
  is_capture: z.boolean(),
  error_occured: z.boolean(),
  is_void: z.boolean().optional(),
  is_refund: z.boolean().optional(),
  amount_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  order: z.object({ id: z.union([z.number().int().positive(), z.string().regex(/^\d{1,20}$/)]) }).passthrough(),
}).passthrough();

type PaymobTransaction = z.infer<typeof paymobTransactionSchema>;

/**
 * Success = a genuine, captured, non-voided, non-refunded payment (A1 rule 1).
 * An authorization that was never captured is NOT a success.
 */
export function paymobOutcome(txn: PaymobTransaction): PaymentOutcome {
  // VOIDED/REFUNDED come only from the HMAC-covered is_voided/is_refunded. The
  // uncovered is_void/is_refund can only BLOCK a success (→ FAILED), never raise a
  // void/refund anomaly: someone replaying a signed body could add them freely.
  if (txn.is_voided) return "VOIDED";
  if (txn.is_refunded) return "REFUNDED";
  if (txn.pending) return "PENDING";
  if (txn.is_void === true || txn.is_refund === true) return "FAILED";
  if (txn.success && !txn.error_occured && !(txn.is_auth && !txn.is_capture)) return "SUCCESS";
  return "FAILED";
}

/**
 * A callback whose HMAC is VALID but whose fields do not match the expected shape
 * (the shape is unconfirmed until the sandbox run). The route records it and answers
 * 200 so Paymob does not retry forever; only field NAMES are kept, never values.
 */
export class PaymobSignedShapeError extends Error {
  constructor(readonly rawEventHash: string, readonly fieldNames: string[]) {
    super("Signed Paymob callback has an unexpected shape.");
    this.name = "PaymobSignedShapeError";
  }
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
      // Unique per attempt (P12: Paymob rejects a repeated merchant_order_id).
      // Informational only — callbacks are matched by the order id, never by this.
      merchant_order_id: input.merchantOrderId ?? input.invoiceId,
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
    const transaction = parsePaymobCallback(rawBody);
    // HMAC first: nothing about an unsigned body is trusted or stored.
    if (!verifyHmac(transaction, signature, secret)) {
      throw new PaymentProviderError("Paymob webhook signature is invalid.", "INVALID_WEBHOOK", 401);
    }
    const parsed = paymobTransactionSchema.safeParse(transaction);
    if (!parsed.success) {
      const fieldNames = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "(root)"))];
      throw new PaymobSignedShapeError(createHash("sha256").update(rawBody).digest("hex"), fieldNames);
    }
    const txn = parsed.data;
    const transactionId = String(txn.id);
    const outcome = paymobOutcome(txn);
    // Idempotency (P2): a success claims the bare transaction id; any other state is
    // stored under "<id>:<state>" so a pending (3-DS) or failed callback never blocks
    // the later success of the SAME transaction.
    return {
      provider: "PAYMOB",
      providerEventId: outcome === "SUCCESS" ? transactionId : `${transactionId}:${outcome}`,
      providerReference: transactionId,
      providerOrderId: String(txn.order.id),
      // merchant_order_id is NOT covered by the HMAC (P1): never used to find the invoice.
      invoiceId: undefined,
      amountMinor: BigInt(txn.amount_cents),
      currency: txn.currency,
      succeeded: outcome === "SUCCESS",
      outcome,
      eventType: outcome === "SUCCESS" ? "PAYMENT_SUCCESS" : "PAYMENT_FAILED",
      rawEventHash: createHash("sha256").update(rawBody).digest("hex"),
      rawPayload: transaction as Record<string, unknown>,
    };
  }
}

export function buildPaymobHmacPayload(event: Record<string, unknown>) {
  return hmacPayload(event);
}
