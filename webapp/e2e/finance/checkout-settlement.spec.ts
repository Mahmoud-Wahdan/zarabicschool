import { createHmac } from "node:crypto";

import { query } from "../support/db";
import { run } from "../support/run";
import { expect, messages, test, visit } from "../support/test";

/**
 * test-plan-session2.md §3 checkout-retry plus §2.1 settlement, end to end:
 * Pay now → the provider page (Paymob test double: accept.paymob.com is not
 * reachable from here and no Paymob keys exist) → refresh reuses the same attempt →
 * Paymob's signed "transaction processed" callback (HMAC with the test secret in
 * .env) settles the invoice once; a replay changes nothing.
 */
test.describe.configure({ mode: "serial" });

const HMAC_FIELDS = [
  "amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction", "id", "integration_id", "is_3d_secure",
  "is_auth", "is_capture", "is_refunded", "is_standalone_payment", "is_voided", "order.id", "owner", "pending",
  "source_data.pan", "source_data.sub_type", "source_data.type", "success",
];
function sign(txn: Record<string, unknown>) {
  const read = (path: string) =>
    path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), txn);
  return createHmac("sha512", process.env.PAYMOB_HMAC_SECRET!).update(HMAC_FIELDS.map((field) => String(read(field) ?? "")).join("")).digest("hex");
}

type Attempt = { status: string; idempotency_key: string; checkout_url: string; provider_order_id: string | null };
const attempts = (invoiceId: string) =>
  query<Attempt>("SELECT status, idempotency_key, checkout_url, provider_order_id FROM payment_attempts WHERE invoice_id = $1 ORDER BY created_at", [invoiceId]);

test("Pay now sends the adult to the provider page with a deterministic first attempt", async ({ open }) => {
  const r = run();
  const page = await open("adult");
  await visit(page, "/en/student/invoices");
  await page.locator("article", { hasText: /800/ }).getByRole("button", { name: messages.en.invoices.payNow }).click();
  await page.waitForURL(/127\.0\.0\.1:4010\/api\/acceptance\/iframes\//);
  await expect(page.getByRole("heading", { name: "Paymob test checkout" })).toBeVisible();
  const rows = await attempts(r.ids.adultInvoice);
  expect(rows).toHaveLength(1);
  expect(rows[0].idempotency_key).toBe(`invoice:${r.ids.adultInvoice}:v1`);
  expect(rows[0].status).toBe("REDIRECTED");
  expect(page.url()).toBe(rows[0].checkout_url);
});

test("coming back and paying again reuses the same attempt and URL (no second order)", async ({ open, api }) => {
  const r = run();
  const page = await open("adult");
  await visit(page, "/en/student/invoices");
  await page.locator("article", { hasText: /800/ }).getByRole("button", { name: messages.en.invoices.payNow }).click();
  await page.waitForURL(/127\.0\.0\.1:4010\/api\/acceptance\/iframes\//);
  const rows = await attempts(r.ids.adultInvoice);
  expect(rows).toHaveLength(1);
  expect(page.url()).toBe(rows[0].checkout_url);

  // Two concurrent checkouts never leave two active attempts (INT-CO-02, over HTTP).
  const adult = await api("adult");
  const responses = await Promise.all([1, 2].map(() => adult.post(`/api/invoices/${r.ids.adultInvoice}/checkout`)));
  for (const response of responses) expect([200, 409]).toContain(response.status());
  const active = (await attempts(r.ids.adultInvoice)).filter((attempt) => ["CREATED", "REDIRECTED"].includes(attempt.status));
  expect(active).toHaveLength(1);
});

test("the signed processed callback settles the invoice once; a replay is a no-op", async ({ api, open }) => {
  const r = run();
  const [attempt] = await attempts(r.ids.adultInvoice);
  expect(attempt.provider_order_id).toBeTruthy();
  const txn = {
    id: 770000000 + Math.floor(Math.random() * 1_000_000),
    success: true, pending: false, is_voided: false, is_refunded: false, is_auth: false, is_capture: false, error_occured: false,
    has_parent_transaction: false, is_3d_secure: true, is_standalone_payment: true,
    amount_cents: 80000, currency: "EGP", order: { id: Number(attempt.provider_order_id) }, created_at: new Date().toISOString(),
    integration_id: 1, owner: 1, source_data: { pan: "2346", sub_type: "MasterCard", type: "card" },
  };
  const paymob = await api("anon", { origin: null });
  const post = () => paymob.post(`/api/payments/paymob/webhook?hmac=${sign(txn)}`, { data: { type: "TRANSACTION", obj: txn } });

  const first = await post();
  expect(first.status()).toBe(200);
  expect((await first.json()).status).toBe("settled");
  const replay = await post();
  expect(replay.status()).toBe(200);
  expect(["already_processed", "already_settled"]).toContain((await replay.json()).status);

  const invoice = await query<{ status: string; subscription_id: string | null }>("SELECT status, subscription_id FROM invoices WHERE id = $1", [r.ids.adultInvoice]);
  expect(invoice[0].status).toBe("PAID");
  expect(invoice[0].subscription_id).toBeTruthy();
  const purchases = await query("SELECT 1 FROM subscription_ledger WHERE invoice_id = $1 AND entry_type = 'INITIAL_PURCHASE'", [r.ids.adultInvoice]);
  expect(purchases).toHaveLength(1);
  const audit = await query<{ event_type: string }>("SELECT event_type::text FROM payment_audit WHERE invoice_id = $1", [r.ids.adultInvoice]);
  expect(audit.map((row) => row.event_type)).toContain("PAID");

  const page = await open("adult");
  await visit(page, "/en/student/invoices");
  await expect(page.locator("article", { hasText: /800/ }).getByText(messages.en.invoices.paidNote)).toBeVisible();
});
