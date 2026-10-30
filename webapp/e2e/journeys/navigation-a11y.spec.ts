import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { ROLE_HOME } from "../support/run";
import { expect, expectHealthyPage, messages, test, visit, type Locale } from "../support/test";

/**
 * The five people of the academy (Admin, Supervisor, teacher, guardian, student), each
 * walking their own menu the way they would: from their dashboard, clicking every item
 * of the side menu in Arabic (RTL) and English (LTR). Every page they reach must render
 * properly (expectHealthyPage), mark its menu item as the current page, and pass an
 * automated accessibility scan (axe, WCAG 2.1 A/AA) with no violation.
 */
const PEOPLE = ["admin", "supervisor", "teacher", "guardian", "student"] as const;
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** axe violations on the page, one readable line per rule with up to three targets. */
export async function a11yViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return result.violations.map(
    (violation) => `${violation.id} (${violation.impact}): ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`,
  );
}

for (const who of PEOPLE) {
  for (const locale of ["ar", "en"] as Locale[]) {
    test(`${who} (${locale}): every menu item opens a healthy, accessible page`, async ({ open }) => {
      test.setTimeout(240_000);
      const page = await open(who, { locale });
      await visit(page, `/${locale}${ROLE_HOME[who]}`);
      const nav = page.getByRole("navigation", { name: messages[locale].appShell.primaryNav });
      const links = nav.getByRole("link");
      await expect(links.first(), "menu").toBeVisible();
      const count = await links.count();
      expect(count, "menu items").toBeGreaterThan(3);
      const items: { name: string; href: string }[] = [];
      for (let index = 0; index < count; index++) {
        const link = links.nth(index);
        items.push({ name: (await link.innerText()).trim(), href: (await link.getAttribute("href")) ?? "" });
      }

      for (const item of items) {
        const label = `${who}/${locale} → ${item.href}`;
        await nav.getByRole("link", { name: item.name, exact: false }).first().click();
        await page.waitForURL((url) => url.pathname === item.href, { timeout: 30_000 });
        await page.waitForLoadState("load");
        await expectHealthyPage(page, locale, label);
        await expect.soft(nav.locator(`a[href="${item.href}"]`), `${label}: current page`).toHaveAttribute("aria-current", "page");
        expect.soft(await a11yViolations(page), `${label}: accessibility`).toEqual([]);
      }
    });
  }
}
