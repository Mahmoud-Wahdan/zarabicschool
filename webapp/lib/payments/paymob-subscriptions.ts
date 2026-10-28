import { createHmac, timingSafeEqual } from "node:crypto";

import { PaymentProviderError } from "./types";

/**
 * Paymob Subscription Module (D44, D54; docs/specs/paymob-subscription-research.md).
 * Only DOCUMENTED calls: auth token (Bearer, ~60 min), subscription transactions,
 * lookup by transaction, PUT next_billing, cancel, and the sign-up intention
 * (`Token <secret key>`). Every id that reaches a URL path is digits only, and a
 * pagination link is followed only on the configured Paymob host. Error messages
 * never carry the response body.
 */
export type PaymobRecord = Record<string, unknown>;

const DIGITS = /^\d{1,20}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_TTL_MS = 50 * 60 * 1000;
const MAX_PAGES = 10;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new PaymentProviderError(`Paymob subscriptions are not configured: ${name} is missing.`, "NOT_CONFIGURED", 503);
  return value;
}

function digitId(value: string | number, field: string) {
  const text = String(value);
  if (!DIGITS.test(text)) throw new PaymentProviderError(`Invalid Paymob ${field}.`, "UPSTREAM_ERROR", 400);
  return text;
}

function asRecord(value: unknown): PaymobRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentProviderError("Paymob returned an invalid response.", "UPSTREAM_ERROR");
  }
  return value as PaymobRecord;
}

export type SignupIntentionInput = {
  planProviderId: string;
  amountMinor: bigint;
  /** Our invoice id: informational at Paymob, never used to match a callback. */
  specialReference: string;
  notificationUrl: string;
  redirectionUrl: string;
  billing: { firstName: string; lastName: string; email: string; phone: string };
};

export class PaymobSubscriptionClient {
  private readonly baseUrl = (process.env.PAYMOB_API_URL ?? "https://accept.paymob.com").replace(/\/$/, "");
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async send(path: string, init: { method: string; body?: unknown; auth: string }): Promise<PaymobRecord> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    if (new URL(url).origin !== new URL(this.baseUrl).origin) {
      throw new PaymentProviderError("Paymob returned a link to another host.", "UPSTREAM_ERROR");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: init.method,
        headers: { "content-type": "application/json", ...(init.auth ? { authorization: init.auth } : {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
      });
    } catch {
      throw new PaymentProviderError("Could not reach Paymob.", "UPSTREAM_ERROR");
    }
    if (!response.ok) throw new PaymentProviderError(`Paymob rejected the request (${response.status}).`, "UPSTREAM_ERROR");
    try {
      return asRecord(await response.json());
    } catch (cause) {
      if (cause instanceof PaymentProviderError) throw cause;
      throw new PaymentProviderError("Paymob returned an invalid response.", "UPSTREAM_ERROR");
    }
  }

  private async bearer(): Promise<string> {
    if (!this.token || this.token.expiresAt <= Date.now()) {
      const response = await this.send("/api/auth/tokens", { method: "POST", body: { api_key: requiredEnv("PAYMOB_API_KEY") }, auth: "" });
      if (typeof response.token !== "string" || !response.token) {
        throw new PaymentProviderError("Paymob response is missing token.", "UPSTREAM_ERROR");
      }
      this.token = { value: response.token, expiresAt: Date.now() + TOKEN_TTL_MS };
    }
    return `Bearer ${this.token.value}`;
  }

  private async authed(path: string, method = "GET", body?: unknown) {
    return this.send(path, { method, body, auth: await this.bearer() });
  }

  /** Every transaction of one subscription (renewals carry api_source SUBSCRIPTION). */
  async listTransactions(providerSubscriptionId: string): Promise<PaymobRecord[]> {
    const id = digitId(providerSubscriptionId, "subscription id");
    const results: PaymobRecord[] = [];
    let next: string | null = `/api/acceptance/subscriptions/${id}/transactions`;
    for (let page = 0; next && page < MAX_PAGES; page += 1) {
      const response = await this.authed(next);
      if (Array.isArray(response.results)) results.push(...response.results.map(asRecord));
      next = typeof response.next === "string" && response.next ? response.next : null;
    }
    return results;
  }

  async getSubscription(providerSubscriptionId: string) {
    return this.authed(`/api/acceptance/subscriptions/${digitId(providerSubscriptionId, "subscription id")}`);
  }

  /** The subscription a sign-up (or renewal) transaction belongs to; null when none. */
  async findByTransaction(transactionId: string): Promise<PaymobRecord | null> {
    const response = await this.authed(`/api/acceptance/subscriptions?transaction=${digitId(transactionId, "transaction id")}`);
    const first = Array.isArray(response.results) ? response.results[0] : undefined;
    return first ? asRecord(first) : null;
  }

  /** D56: Paymob bills in fixed day counts, so the platform sets the next date itself. */
  async updateNextBilling(providerSubscriptionId: string, nextBilling: string) {
    if (!YMD.test(nextBilling)) throw new PaymentProviderError("Invalid next billing date.", "UPSTREAM_ERROR", 400);
    return this.authed(`/api/acceptance/subscriptions/${digitId(providerSubscriptionId, "subscription id")}`, "PUT", { next_billing: nextBilling });
  }

  /** Final at Paymob: stops all future billing immediately (D52 keeps our period). */
  async cancel(providerSubscriptionId: string) {
    return this.authed(`/api/acceptance/subscriptions/${digitId(providerSubscriptionId, "subscription id")}/cancel`, "POST");
  }

  /**
   * A monthly plan at Paymob (D53, D55, D57): MOTO integration for the renewals,
   * frequency 30 (the platform then sets each next_billing itself, D56), the first
   * payment as month 1 with the same amount after it, no pre-charge e-mail.
   * retrial_days is left to Paymob's default (its meaning is undocumented — OPEN).
   */
  async createPlan(input: { name: string; amountMinor: bigint; webhookUrl: string }): Promise<string> {
    const integration = Number(digitId(requiredEnv("PAYMOB_MOTO_INTEGRATION_ID_EGP"), "MOTO integration id"));
    if (input.amountMinor <= BigInt(0) || input.amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new PaymentProviderError("Amount is outside Paymob's supported range.", "UPSTREAM_ERROR", 400);
    }
    const response = await this.authed("/api/acceptance/subscription-plans", "POST", {
      name: input.name.slice(0, 100),
      frequency: 30,
      plan_type: "rent",
      amount_cents: Number(input.amountMinor),
      use_transaction_amount: true,
      is_active: true,
      integration,
      reminder_days: null,
      number_of_deductions: null,
      webhook_url: input.webhookUrl,
    });
    return digitId(response.id as string, "plan id");
  }

  /** Sign-up (D55): one 3DS payment that buys month 1 and saves the card. */
  async createSignupIntention(input: SignupIntentionInput): Promise<{ checkoutUrl: string; providerOrderId: string }> {
    const secretKey = requiredEnv("PAYMOB_SECRET_KEY");
    const publicKey = requiredEnv("PAYMOB_PUBLIC_KEY");
    const integrationId = Number(digitId(requiredEnv("PAYMOB_INTEGRATION_ID_EGP"), "integration id"));
    if (input.amountMinor <= BigInt(0) || input.amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new PaymentProviderError("Amount is outside Paymob's supported range.", "UPSTREAM_ERROR", 400);
    }
    const response = await this.send("/v1/intention/", {
      method: "POST",
      auth: `Token ${secretKey}`,
      body: {
        amount: Number(input.amountMinor),
        currency: "EGP",
        payment_methods: [integrationId],
        subscription_plan_id: Number(digitId(input.planProviderId, "plan id")),
        items: [],
        billing_data: {
          first_name: input.billing.firstName,
          last_name: input.billing.lastName,
          email: input.billing.email,
          phone_number: input.billing.phone,
        },
        special_reference: input.specialReference,
        notification_url: input.notificationUrl,
        redirection_url: input.redirectionUrl,
      },
    });
    if (typeof response.client_secret !== "string" || !response.client_secret) {
      throw new PaymentProviderError("Paymob response is missing client secret.", "UPSTREAM_ERROR");
    }
    const orderId = digitId(response.intention_order_id as string, "order id");
    return {
      providerOrderId: orderId,
      checkoutUrl: `${this.baseUrl}/unifiedcheckout/?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(response.client_secret)}`,
    };
  }
}

/**
 * Subscription callback (CONFIRMED): body field `hmac` = SHA-512 HMAC over
 * `trigger_type + "for" + subscription_data.id`. It signs nothing about a charge, so
 * only the trigger and the id are returned: the caller re-fetches everything else.
 */
export function verifySubscriptionCallback(rawBody: string): { triggerType: string; providerSubscriptionId: string } {
  let body: PaymobRecord;
  try {
    body = asRecord(JSON.parse(rawBody));
  } catch {
    throw new PaymentProviderError("Paymob subscription callback JSON is invalid.", "INVALID_WEBHOOK", 400);
  }
  const triggerType = body.trigger_type;
  const data = body.subscription_data;
  const rawId = data && typeof data === "object" && !Array.isArray(data) ? (data as PaymobRecord).id : undefined;
  if (typeof triggerType !== "string" || triggerType.length > 64 || (typeof rawId !== "string" && typeof rawId !== "number") || !DIGITS.test(String(rawId))) {
    throw new PaymentProviderError("Paymob subscription callback has an unexpected shape.", "INVALID_WEBHOOK", 400);
  }
  const providerSubscriptionId = String(rawId);
  const signature = typeof body.hmac === "string" ? body.hmac.trim().toLowerCase() : "";
  const expected = createHmac("sha512", requiredEnv("PAYMOB_HMAC_SECRET")).update(`${triggerType}for${providerSubscriptionId}`).digest("hex");
  const received = Buffer.from(signature, "utf8");
  const calculated = Buffer.from(expected, "utf8");
  if (received.length !== calculated.length || !timingSafeEqual(received, calculated)) {
    throw new PaymentProviderError("Paymob subscription callback signature is invalid.", "INVALID_WEBHOOK", 401);
  }
  return { triggerType, providerSubscriptionId };
}
