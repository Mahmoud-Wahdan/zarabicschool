import { createHmac } from "node:crypto";

import { buildPaymobHmacPayload, PaymobProvider } from "../../lib/payments";

const event = {
  amount_cents: 80000,
  created_at: "2026-10-06T12:00:00Z",
  currency: "EGP",
  error_occured: false,
  has_parent_transaction: false,
  id: 12345,
  integration_id: 77,
  is_3d_secure: false,
  is_auth: true,
  is_capture: true,
  is_refunded: false,
  is_standalone_payment: true,
  is_voided: false,
  order: { id: 999 },
  owner: 1,
  pending: false,
  source_data: { pan: "1234", sub_type: "Visa", type: "card" },
  success: true,
};

describe("PaymobProvider", () => {
  beforeEach(() => {
    process.env.PAYMOB_HMAC_SECRET = "test-secret";
  });

  it("verifies a valid signed successful event", () => {
    const signature = createHmac("sha512", process.env.PAYMOB_HMAC_SECRET!)
      .update(buildPaymobHmacPayload(event))
      .digest("hex");
    const result = new PaymobProvider().verifyWebhook(JSON.stringify(event), signature);
    expect(result).toMatchObject({
      providerReference: "12345",
      amountMinor: BigInt(80000),
      currency: "EGP",
      succeeded: true,
    });
  });

  it("rejects a replay with an invalid signature", () => {
    expect(() => new PaymobProvider().verifyWebhook(JSON.stringify(event), "bad"))
      .toThrow("signature is invalid");
  });

  it("does not silently enable USD through Paymob", async () => {
    await expect(new PaymobProvider().createCheckout({
      invoiceId: "invoice",
      amountMinor: BigInt(10),
      currency: "USD",
      description: "test",
      customer: { firstName: "A", lastName: "B", email: "a@example.com", phone: "+201000000000" },
    }, "key")).rejects.toThrow("EGP only");
  });
});
