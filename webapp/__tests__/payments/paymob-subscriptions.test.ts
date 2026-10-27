import { createHmac } from "node:crypto";

import {
  PaymobSubscriptionClient,
  verifySubscriptionCallback,
} from "../../lib/payments/paymob-subscriptions";
import { PaymentProviderError } from "../../lib/payments/types";

/**
 * Paymob Subscription Module client (D44, D54, research 2026-10-27). A fake fetch at
 * the HTTP boundary records every call: the tests check the documented URLs, verbs
 * and auth schemes, and that nothing outside a digit-only id reaches a URL path.
 * Env values here are dummies set for the test only.
 */
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const key = `${method} ${url.replace("https://paymob.test", "")}`;
    if (!(key in routes)) return new Response("{}", { status: 404 });
    const value = routes[key];
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, impl };
}

const ENV_NAMES = ["PAYMOB_API_URL", "PAYMOB_API_KEY", "PAYMOB_HMAC_SECRET", "PAYMOB_SECRET_KEY", "PAYMOB_PUBLIC_KEY", "PAYMOB_INTEGRATION_ID_EGP"] as const;
const saved: Partial<Record<string, string | undefined>> = {};

beforeEach(() => {
  for (const name of ENV_NAMES) saved[name] = process.env[name];
  process.env.PAYMOB_API_URL = "https://paymob.test";
  process.env.PAYMOB_API_KEY = "test-api-key";
  process.env.PAYMOB_HMAC_SECRET = "test-hmac-secret";
  process.env.PAYMOB_INTEGRATION_ID_EGP = "111";
  delete process.env.PAYMOB_SECRET_KEY;
  delete process.env.PAYMOB_PUBLIC_KEY;
});

afterEach(() => {
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const TOKEN = { "POST /api/auth/tokens": { token: "bearer-1" } };

describe("Paymob subscription client", () => {
  it("PS-01: lists a subscription's transactions with a Bearer token from /api/auth/tokens, following pages", async () => {
    const { calls, impl } = fakeFetch({
      ...TOKEN,
      "GET /api/acceptance/subscriptions/7400/transactions": { next: "https://paymob.test/api/acceptance/subscriptions/7400/transactions?page=2", results: [{ id: 1 }] },
      "GET /api/acceptance/subscriptions/7400/transactions?page=2": { next: null, results: [{ id: 2 }] },
    });
    const client = new PaymobSubscriptionClient(impl);
    const transactions = await client.listTransactions("7400");
    expect(transactions.map((txn) => txn.id)).toEqual([1, 2]);
    expect(calls[0]).toMatchObject({ method: "POST", body: { api_key: "test-api-key" } });
    expect(calls[1].headers.authorization).toBe("Bearer bearer-1");
    expect(calls.filter((call) => call.url.endsWith("/api/auth/tokens"))).toHaveLength(1); // token reused
  });

  it("PS-02: a pagination link to another host is never followed (SSRF guard)", async () => {
    const { calls, impl } = fakeFetch({
      ...TOKEN,
      "GET /api/acceptance/subscriptions/7400/transactions": { next: "https://evil.example/steal", results: [{ id: 1 }] },
    });
    await expect(new PaymobSubscriptionClient(impl).listTransactions("7400")).rejects.toBeInstanceOf(PaymentProviderError);
    expect(calls.some((call) => call.url.includes("evil.example"))).toBe(false);
  });

  it("PS-03: ids that are not digits never reach a URL", async () => {
    const { calls, impl } = fakeFetch(TOKEN);
    const client = new PaymobSubscriptionClient(impl);
    for (const bad of ["../plans", "1/cancel", "", "12a"]) {
      await expect(client.listTransactions(bad)).rejects.toBeInstanceOf(PaymentProviderError);
      await expect(client.cancel(bad)).rejects.toBeInstanceOf(PaymentProviderError);
    }
    expect(calls).toHaveLength(0);
  });

  it("PS-04: next_billing is changed with PUT /subscriptions/{id}; cancel is POST /subscriptions/{id}/cancel", async () => {
    const { calls, impl } = fakeFetch({
      ...TOKEN,
      "PUT /api/acceptance/subscriptions/7400": { id: 7400, next_billing: "2026-12-10" },
      "POST /api/acceptance/subscriptions/7400/cancel": { id: 7400, state: "canceled" },
    });
    const client = new PaymobSubscriptionClient(impl);
    await client.updateNextBilling("7400", "2026-12-10");
    await expect(client.cancel("7400")).resolves.toMatchObject({ state: "canceled" });
    expect(calls[1]).toMatchObject({ method: "PUT", body: { next_billing: "2026-12-10" } });
    expect(calls[2].method).toBe("POST");
    await expect(client.updateNextBilling("7400", "10/12/2026")).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it("PS-05: finds the subscription created by a sign-up transaction", async () => {
    const { impl } = fakeFetch({
      ...TOKEN,
      "GET /api/acceptance/subscriptions?transaction=555": { results: [{ id: 7400, state: "active" }] },
    });
    await expect(new PaymobSubscriptionClient(impl).findByTransaction("555")).resolves.toMatchObject({ id: 7400 });
  });

  it("PS-06: an upstream error is an UPSTREAM_ERROR without the response body", async () => {
    const { impl } = fakeFetch({ ...TOKEN, "POST /api/acceptance/subscriptions/7400/cancel": new Response("secret detail", { status: 400 }) });
    const error = await new PaymobSubscriptionClient(impl).cancel("7400").catch((cause) => cause);
    expect(error).toBeInstanceOf(PaymentProviderError);
    expect(error.code).toBe("UPSTREAM_ERROR");
    expect(String(error.message)).not.toContain("secret detail");
  });

  it("PS-07: sign-up answers NOT_CONFIGURED while PAYMOB_SECRET_KEY / PAYMOB_PUBLIC_KEY are missing, without calling Paymob", async () => {
    const { calls, impl } = fakeFetch(TOKEN);
    const error = await new PaymobSubscriptionClient(impl)
      .createSignupIntention({ planProviderId: "140", amountMinor: BigInt(100000), specialReference: "inv-1", notificationUrl: "https://app.test/hook", redirectionUrl: "https://app.test/back", billing: { firstName: "A", lastName: "B", email: "a@b.test", phone: "+201000000000" } })
      .catch((cause) => cause);
    expect(error).toBeInstanceOf(PaymentProviderError);
    expect(error.code).toBe("NOT_CONFIGURED");
    expect(calls).toHaveLength(0);
  });

  it("PS-08: sign-up posts /v1/intention/ with the secret key, the plan and the 3DS integration, and returns the Unified Checkout URL", async () => {
    process.env.PAYMOB_SECRET_KEY = "sk_test_dummy";
    process.env.PAYMOB_PUBLIC_KEY = "pk_test_dummy";
    const { calls, impl } = fakeFetch({ "POST /v1/intention/": { client_secret: "cs_1", intention_order_id: 9988 } });
    const result = await new PaymobSubscriptionClient(impl).createSignupIntention({
      planProviderId: "140", amountMinor: BigInt(100000), specialReference: "inv-1",
      notificationUrl: "https://app.test/hook", redirectionUrl: "https://app.test/back",
      billing: { firstName: "A", lastName: "B", email: "a@b.test", phone: "+201000000000" },
    });
    expect(calls[0].headers.authorization).toBe("Token sk_test_dummy");
    expect(calls[0].body).toMatchObject({ amount: 100000, currency: "EGP", payment_methods: [111], subscription_plan_id: 140, special_reference: "inv-1" });
    expect(result.providerOrderId).toBe("9988");
    expect(result.checkoutUrl).toBe("https://paymob.test/unifiedcheckout/?publicKey=pk_test_dummy&clientSecret=cs_1");
  });
});

describe("Paymob subscription callback signature", () => {
  const sign = (trigger: string, id: number | string) => createHmac("sha512", "test-hmac-secret").update(`${trigger}for${id}`).digest("hex");

  it("PS-09: a valid body hmac over trigger_type + 'for' + subscription id is accepted and yields only the trigger and the id", () => {
    const body = JSON.stringify({ trigger_type: "Successful Transaction", hmac: sign("Successful Transaction", 7400), subscription_data: { id: 7400, amount_cents: 1 } });
    expect(verifySubscriptionCallback(body)).toEqual({ triggerType: "Successful Transaction", providerSubscriptionId: "7400" });
  });

  it("PS-10: a wrong, missing or swapped hmac is refused with 401 INVALID_WEBHOOK", () => {
    const cases = [
      { trigger_type: "Successful Transaction", hmac: sign("Failed Transaction", 7400), subscription_data: { id: 7400 } },
      { trigger_type: "Successful Transaction", subscription_data: { id: 7400 } },
      { trigger_type: "Successful Transaction", hmac: sign("Successful Transaction", 7401), subscription_data: { id: 7400 } },
    ];
    for (const body of cases) {
      const error = (() => { try { verifySubscriptionCallback(JSON.stringify(body)); } catch (cause) { return cause; } })() as PaymentProviderError;
      expect(error).toBeInstanceOf(PaymentProviderError);
      expect(error.status).toBe(401);
    }
  });

  it("PS-11: malformed JSON or a non-digit subscription id is a 400", () => {
    for (const raw of ["not json", JSON.stringify({ trigger_type: "x", hmac: sign("x", "../1"), subscription_data: { id: "../1" } })]) {
      const error = (() => { try { verifySubscriptionCallback(raw); } catch (cause) { return cause; } })() as PaymentProviderError;
      expect(error.status).toBe(400);
    }
  });
});
