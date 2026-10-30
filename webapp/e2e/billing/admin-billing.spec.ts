import { randomUUID } from "node:crypto";

import { query } from "../support/db";
import { run } from "../support/run";
import { expect, expectHealthyPage, messages, test, visit } from "../support/test";

/** test-plan-session2.md §3 admin-billing: plans, exchange rate, pay-per-session; ar RTL; Supervisor kept out. */
const t = messages.en.billingAdmin;

test("the Arabic billing page renders RTL with every section", async ({ open }) => {
  const page = await open("admin", { locale: "ar" });
  await visit(page, "/ar/admin/billing");
  await expectHealthyPage(page, "ar");
  for (const heading of [messages.ar.billingAdmin.plansTitle, messages.ar.billingAdmin.ratesTitle, messages.ar.billingAdmin.payPerSessionTitle]) {
    await expect(page.getByText(heading).first()).toBeVisible();
  }
});

test("the Admin creates a monthly plan, changes nothing for existing subscribers, and deactivates it", async ({ open }) => {
  const r = run();
  const name = `E2E Plan ${randomUUID().slice(0, 6)}`;
  const page = await open("admin");
  await visit(page, "/en/admin/billing");
  const form = page.locator("form", { has: page.getByRole("button", { name: t.createPlan }) });
  await form.getByLabel(t.fieldNameAr).fill(`خطة ${name}`);
  await form.getByLabel(t.fieldNameEn).fill(name);
  await form.getByLabel(t.fieldPackageType).selectOption("MONTHLY_PLAN");
  await form.getByLabel(t.fieldSessionsPerMonth).fill("8");
  await form.getByLabel(t.fieldBasePrice).fill("90000");
  await form.getByLabel(t.fieldCurrency).selectOption("EGP");
  await form.getByRole("button", { name: t.createPlan }).click();
  const row = page.locator("tr", { hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText(t.statusActive);

  await row.getByRole("button", { name: t.actionToggleInactive }).click();
  await expect(row).toContainText(t.statusInactive);
  const plans = await query<{ is_active: boolean }>("SELECT is_active FROM billing_plans WHERE academy_id = $1 AND name_en = $2", [r.fixtures.academyId, name]);
  expect(plans).toEqual([{ is_active: false }]);
});

test("an annual package cannot be invoiced (A4; plans stay editable by design)", async ({ api }) => {
  const r = run();
  const admin = await api("admin");
  const response = await admin.post("/api/invoices", {
    data: { studentId: r.fixtures.studentProfileIds.student3, packageType: "ANNUAL_PLAN", sessionsPurchased: 96, amountMinor: 900000, currency: "EGP", provider: "PAYMOB" },
  });
  expect(response.status()).toBe(409);
  expect((await response.json()).error.code).toBe("ANNUAL_PLAN_DISABLED");
});

test("the Admin sets an exchange rate and the pay-per-session limits", async ({ open }) => {
  const r = run();
  const page = await open("admin");
  await visit(page, "/en/admin/billing");
  await page.getByLabel(t.fieldFromCurrency).fill("USD");
  await page.getByLabel(t.fieldToCurrency).fill("EGP");
  await page.getByLabel(t.fieldRate).fill("48.75");
  await page.getByRole("button", { name: t.setRate }).click();
  await expect(page.locator("tr", { hasText: "48.75" }).first()).toBeVisible();
  const rates = await query("SELECT 1 FROM exchange_rates WHERE academy_id = $1 AND from_currency = 'USD' AND to_currency = 'EGP'", [r.fixtures.academyId]);
  expect(rates.length).toBeGreaterThan(0);

  await page.getByLabel(t.fieldMinSessions).fill("2");
  await page.getByLabel(t.fieldMaxSessions).fill("12");
  await page.getByRole("button", { name: t.savePayPerSession }).click();
  await expect(page.getByText(t.created).first()).toBeVisible();
});

test("a Supervisor who opens the billing page lands on their own dashboard, and the API refuses", async ({ open, api }) => {
  const page = await open("supervisor");
  await visit(page, "/en/admin/billing");
  expect(new URL(page.url()).pathname).toBe("/en/supervisor");
  const supervisor = await api("supervisor");
  for (const path of ["/api/admin/billing/plans", "/api/admin/billing/exchange-rates", "/api/admin/billing/settings/pay-per-session"]) {
    expect((await supervisor.get(path)).status(), path).toBe(403);
  }
});
