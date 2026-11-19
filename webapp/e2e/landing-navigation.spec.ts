import { expect, test } from "@playwright/test";

for (const locale of ["ar", "en"]) {
  test.describe(`Landing navigation in ${locale}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/${locale}`);
    });

    test("the intermediate header offers one login and a language switch", async ({ page }) => {
      await page.setViewportSize({ width: 1100, height: 800 });
      const header = page.getByRole("banner");
      await expect(header.locator('a[hreflang]:visible')).toHaveCount(1);
      await expect(header.locator('a[href$="/login"]:visible')).toHaveCount(1);
    });

    test("Escape returns focus from a mobile menu link to the disclosure", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      const toggle = page.getByRole("banner").getByRole("button", { expanded: false });
      await expect(async () => {
        await toggle.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("banner").getByRole("button", { expanded: true })).toBeVisible({ timeout: 500 });
      }).toPass({ timeout: 15000 });
      await page.keyboard.press("Tab");
      await expect(page.getByRole("banner").locator('a[href="#top"]:visible').last()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
    });

    test("closed FAQ buttons continue to reference their answers", async ({ page }) => {
      const questions = page.locator("#faq button[aria-controls]");
      const ids = await questions.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-controls")!));
      expect(ids).toHaveLength(5);
      for (const id of ids) {
        const answer = page.locator(`[id="${id}"]`);
        await expect(answer).toBeAttached();
        await expect(answer).toBeHidden();
      }
      await expect(async () => {
        await questions.first().click();
        await expect(page.locator(`[id="${ids[0]}"]`)).toBeVisible({ timeout: 500 });
      }).toPass({ timeout: 15000 });
    });
  });
}
