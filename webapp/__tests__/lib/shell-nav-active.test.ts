jest.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "ar" }));
jest.mock("../../i18n/navigation", () => ({ Link: () => null, usePathname: () => "/admin" }));

import { isActive } from "../../app/_components/dashboard-shell";

/**
 * S-14 finding (2026-10-29): on every Admin page the sidebar showed TWO active items,
 * the page itself and "Dashboard", because "/admin/sessions" starts with "/admin/".
 * A role's home link is active only on the home page itself.
 */
describe("sidebar active link", () => {
  it("NAV-01: a role home is active only on itself", () => {
    expect(isActive("/admin", "/admin")).toBe(true);
    expect(isActive("/admin/sessions", "/admin")).toBe(false);
    expect(isActive("/teacher/payroll", "/teacher")).toBe(false);
  });

  it("NAV-02: other items are active on themselves and their sub-pages", () => {
    expect(isActive("/admin/sessions", "/admin/sessions")).toBe(true);
    expect(isActive("/admin/sessions/123", "/admin/sessions")).toBe(true);
    expect(isActive("/admin/sessions-old", "/admin/sessions")).toBe(false);
  });
});
