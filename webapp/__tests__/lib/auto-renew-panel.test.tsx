import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

import AutoRenewPanel from "../../app/_components/billing/auto-renew-panel";
import ChargeDateRail from "../../app/_components/billing/charge-date-rail";
import { upcomingChargeDates } from "../../lib/billing/renewal-dates";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

/**
 * Automatic-renewal panel (D52-D57): the consent card shows the real charge dates
 * (D56 same day each month), the consent box starts unticked and the button stays
 * disabled until it is ticked, a live renewal shows its state and a cancel control,
 * and nothing from Paymob (ids, card data) is ever rendered.
 */
const CAIRO = "Africa/Cairo";
const plans = [{ id: "p1", name: "Monthly 8", sessions: 8, priceLabel: "EGP 1,000.00", priceMinor: "100000" }];
const students = [{ id: "s1", name: "Ali" }, { id: "s2", name: "Mona" }];

function render(locale: "ar" | "en", props: Partial<Parameters<typeof AutoRenewPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en} timeZone={CAIRO}>
      <AutoRenewPanel students={students} plans={plans} subscriptions={[]} timeZone={CAIRO} now="2027-01-31T10:00:00.000Z" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("automatic renewal panel", () => {
  it("UI-01: the next charge dates follow D56 (31 Jan → 28 Feb → 31 Mar)", () => {
    expect(upcomingChargeDates(new Date("2027-01-31T10:00:00Z"), CAIRO, 3)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it("UI-02: the rail is an ordered list of real dates, today first", () => {
    const html = renderToStaticMarkup(<ChargeDateRail dates={["2027-01-31", "2027-02-28", "2027-03-31"]} locale="en" firstLabel="Today, month 1" laterLabel="Automatic charge" />);
    expect(html.startsWith("<ol")).toBe(true);
    expect(html.match(/<time dateTime="2027-0\d-\d\d"/g)).toHaveLength(3);
    expect(html.indexOf("Today, month 1")).toBeLessThan(html.indexOf("Automatic charge"));
  });

  it("UI-03: the consent box starts unticked and the start button is disabled (ar and en)", () => {
    for (const locale of ["ar", "en"] as const) {
      const html = render(locale);
      expect(html).toMatch(/<input[^>]*type="checkbox"(?![^>]*checked)[^>]*>/);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(Continue to payment|المتابعة إلى الدفع)/);
    }
  });

  it("UI-04: a live renewal shows its state, the next charge and a cancel control; its student leaves the sign-up list", () => {
    const html = render("en", {
      subscriptions: [{ id: "b1", studentId: "s1", studentName: "Ali", planName: "Monthly 8", payerName: "Guardian", priceLabel: "EGP 1,000.00", status: "ACTIVE", autoRenew: true, currentPeriodEnd: "2027-02-27T22:00:00.000Z", graceEndsAt: null }],
    });
    expect(html).toContain("Renews automatically");
    expect(html).toContain("Cancel automatic renewal");
    expect(html).not.toMatch(/<option value="s1"/);
    expect(html).toMatch(/<option value="s2"/);
  });

  it("UI-05: with no plan open for automatic renewal the panel says so and shows no form", () => {
    const html = render("en", { plans: [] });
    expect(html).toContain("No monthly plan is open for automatic renewal yet.");
    expect(html).not.toContain('type="checkbox"');
  });

  it("UI-06 (static): the panel never renders Paymob ids or logs", () => {
    const source = readFileSync(join(process.cwd(), "app/_components/billing/auto-renew-panel.tsx"), "utf8");
    expect(source).not.toMatch(/providerSubscriptionId|providerPlanId|console\./);
  });
});
