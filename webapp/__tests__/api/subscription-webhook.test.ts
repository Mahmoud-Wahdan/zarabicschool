import { createHmac } from "node:crypto";

import { POST as subscriptionWebhookRoute } from "../../app/api/payments/paymob/subscription-webhook/route";

/**
 * Paymob subscription callback route (D44, research 2026-10-27): public, signed by a
 * body `hmac` over trigger_type + "for" + subscription id. Only a trigger: an unknown
 * subscription answers 200 "unmatched" without any Paymob call. The HMAC secret is a
 * test-only value set in the process env and restored afterwards.
 */
const SECRET = `demo_test_sub_hmac_${Math.random().toString(36).slice(2)}`;
let saved: string | undefined;

beforeAll(() => {
  saved = process.env.PAYMOB_HMAC_SECRET;
  process.env.PAYMOB_HMAC_SECRET = SECRET;
});

afterAll(async () => {
  if (saved === undefined) delete process.env.PAYMOB_HMAC_SECRET;
  else process.env.PAYMOB_HMAC_SECRET = saved;
  const { disconnectPrisma } = await import("../../lib/prisma");
  await disconnectPrisma();
});

const sign = (trigger: string, id: string) => createHmac("sha512", SECRET).update(`${trigger}for${id}`).digest("hex");
const post = (body: string) =>
  subscriptionWebhookRoute(new Request("http://localhost:3000/api/payments/paymob/subscription-webhook", { method: "POST", headers: { "content-type": "application/json" }, body }));

describe("subscription webhook route", () => {
  it("SW-01: a valid signature for an unknown subscription answers 200 unmatched", async () => {
    const response = await post(JSON.stringify({ trigger_type: "Successful Transaction", hmac: sign("Successful Transaction", "99999999999999"), subscription_data: { id: "99999999999999" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "unmatched" });
  });

  it("SW-02: a bad signature is 401 and says nothing else", async () => {
    const response = await post(JSON.stringify({ trigger_type: "Successful Transaction", hmac: "0".repeat(128), subscription_data: { id: 1 } }));
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).not.toMatch(/\n\s+at |prisma/i);
  });

  it("SW-03: malformed JSON is 400; a body over 64 KB is 413", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post(JSON.stringify({ pad: "x".repeat(70 * 1024) }))).status).toBe(413);
  });
});
