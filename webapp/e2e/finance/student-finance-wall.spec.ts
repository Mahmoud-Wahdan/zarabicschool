import { run } from "../support/run";
import { expect, expectHealthyPage, messages, test, visit } from "../support/test";

/** test-plan-session1.md §5.2 — the student finance wall (CONTEXT §9, B5: adult AND no guardian). */
const invoicesNav = messages.en.appShell.nav.invoices;

test("scenario A: a student with a guardian has no invoices link, is sent home from the page, and the API refuses", async ({ open }) => {
  const r = run();
  const page = await open("student");
  await visit(page, "/en/student");
  await expectHealthyPage(page, "en");
  await expect(page.getByRole("link", { name: invoicesNav })).toHaveCount(0);
  // The dashboard shows how many sessions remain, never money.
  expect(await page.locator("main").innerText()).not.toMatch(/\bEGP\b|\bUSD\b|800\.00/);

  await visit(page, "/en/student/invoices");
  await page.waitForURL("**/en/student");

  const statuses = await page.evaluate(async (invoiceId) => {
    const checkout = await fetch(`/api/invoices/${invoiceId}/checkout`, { method: "POST" });
    const list = await fetch("/api/invoices");
    const one = await fetch(`/api/invoices/${invoiceId}`);
    return [checkout.status, list.status, one.status];
  }, r.ids.familyInvoice);
  expect(statuses).toEqual([403, 403, 403]);
});

test("scenario B: an adult paying for themselves reaches the invoices page and sees Pay now", async ({ open }) => {
  const page = await open("adult");
  await visit(page, "/en/student");
  await page.getByRole("link", { name: invoicesNav }).first().click();
  await page.waitForURL("**/en/student/invoices");
  await expectHealthyPage(page, "en");
  // The 500.00 invoice stays pending all run (the checkout spec pays the 800.00 one).
  const pending = page.locator("article", { hasText: /500/ });
  await expect(pending.getByRole("button", { name: messages.en.invoices.payNow })).toBeVisible();
});

test("the guardian pays for the child: the family invoice is on the guardian's page", async ({ open }) => {
  const page = await open("guardian");
  await visit(page, "/en/guardian/invoices");
  await expectHealthyPage(page, "en");
  await expect(page.getByRole("button", { name: messages.en.invoices.payNow }).first()).toBeVisible();
});
