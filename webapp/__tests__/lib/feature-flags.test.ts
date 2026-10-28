import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isAutoRenewalEnabled } from "../../lib/config/features";

/**
 * A6 (owner, 2026-10-28): automatic monthly renewal is not verified with Paymob yet,
 * so the payer's "monthly auto-renewal" section stays hidden behind a flag that is
 * OFF by default (env FEATURE_AUTO_RENEWAL=true turns it on).
 */
describe("feature flags (A6)", () => {
  it("FF-01: auto-renewal is off unless FEATURE_AUTO_RENEWAL is exactly true", () => {
    expect(isAutoRenewalEnabled({})).toBe(false);
    expect(isAutoRenewalEnabled({ FEATURE_AUTO_RENEWAL: "" })).toBe(false);
    expect(isAutoRenewalEnabled({ FEATURE_AUTO_RENEWAL: "false" })).toBe(false);
    expect(isAutoRenewalEnabled({ FEATURE_AUTO_RENEWAL: "1" })).toBe(false);
    expect(isAutoRenewalEnabled({ FEATURE_AUTO_RENEWAL: "true" })).toBe(true);
    expect(isAutoRenewalEnabled({ FEATURE_AUTO_RENEWAL: " TRUE " })).toBe(true);
  });

  it.each(["guardian", "student"])("FF-02 (static): the %s invoices page shows and loads auto-renewal only when the flag is on", (role) => {
    const page = readFileSync(join(process.cwd(), `app/[locale]/${role}/invoices/page.tsx`), "utf8");
    expect(page).toMatch(/isAutoRenewalEnabled\(\)/);
    // The panel and its data load sit behind the flag (no renewal queries when it is off).
    expect(page).toMatch(/autoRenewal\s*\?\s*await Promise\.all\(\[loadRenewalRows/);
    expect(page).toMatch(/\{autoRenewal \? \(\s*<div className="mt-6">\s*<AutoRenewPanel/);
  });
});
