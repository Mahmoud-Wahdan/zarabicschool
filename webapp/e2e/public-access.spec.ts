import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const locale of ["ar", "en"]) {
  test(`sign-in labels, validation and keyboard controls in ${locale}`, async ({ page }) => {
    await page.goto(`/${locale}/login`);
    const username = page.locator("#username");
    const password = page.locator("#password");
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const toggle = page.locator('form button[aria-pressed]');
    await expect(async () => {
      if (await toggle.getAttribute("aria-pressed") !== "true") {
        await toggle.focus();
        await page.keyboard.press("Space");
      }
      await expect(password).toHaveAttribute("type", "text", { timeout: 500 });
    }).toPass({ timeout: 15000 });
    await page.locator('button[type="submit"]').click();
    await expect(username).toBeFocused();
    await expect(username).toHaveAttribute("aria-describedby", "username-error");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(results.violations.map(issue => issue.id)).toEqual([]);
  });

  test(`anonymous dashboard redirects in ${locale}`, async ({ page }) => {
    for (const role of ["admin", "supervisor", "teacher", "student", "guardian"]) {
      await page.goto(`/${locale}/${role}`);
      await expect(page).toHaveURL(new RegExp(`/${locale}/login(?:\\?|$)`));
      await expect(page.locator("#username")).toBeVisible();
    }
  });
}
