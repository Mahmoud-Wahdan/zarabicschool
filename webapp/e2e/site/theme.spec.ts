import { expect, test, visit } from "../support/test";
import { BASE_URL, clientIp } from "../support/run";

/**
 * Dark mode (owner, 2026-10-31): the header switch cycles light -> dark -> device,
 * stores the choice in the `theme` cookie, and the server writes it on <html> so a
 * reload starts in the chosen theme (no light flash). Device = no attribute.
 */
test("the theme switch cycles light, dark and device, and the choice survives a reload", async ({ open }) => {
  const page = await open("admin");
  await page.context().clearCookies({ name: "theme" });
  await visit(page, "/en/admin");
  const html = page.locator("html");
  const button = page.locator("[data-theme-choice]");
  await expect(button).toHaveAttribute("data-theme-choice", "system");
  await expect(html).not.toHaveAttribute("data-theme", /.+/);

  await button.click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await button.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect((await page.context().cookies(BASE_URL)).find((row) => row.name === "theme")?.value).toBe("dark");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await button.click();
  await expect(html).not.toHaveAttribute("data-theme", /.+/);
  expect((await page.context().cookies(BASE_URL)).find((row) => row.name === "theme")).toBeUndefined();
});

// The public pages carry the same switch, for a visitor with no account, on a phone too.
for (const path of ["/en", "/ar", "/en/apply", "/en/apply?type=student", "/en/login", "/ar/login"]) {
  for (const width of [1280, 360]) {
    test(`a visitor can switch to dark on ${path} at ${width}px and the choice survives a reload`, async ({ open }) => {
      const page = await open("anon", { ip: clientIp("theme") });
      await page.setViewportSize({ width, height: 800 });
      await visit(page, path);
      const html = page.locator("html");
      const button = page.locator("[data-theme-choice]");
      await expect(button).toBeVisible();
      await expect(button).toHaveCount(1);

      await button.click();
      await expect(html).toHaveAttribute("data-theme", "light");
      await button.click();
      await expect(html).toHaveAttribute("data-theme", "dark");

      await page.reload();
      await expect(html).toHaveAttribute("data-theme", "dark");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}

test("a dark page uses the dark surface and keeps the side menu navy", async ({ open }) => {
  const page = await open("admin");
  await page.context().addCookies([{ name: "theme", value: "dark", url: BASE_URL }]);
  await visit(page, "/en/admin");
  const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const nav = await page.locator("aside.app-nav").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(body).not.toBe("rgb(255, 255, 255)");
  // Deep navy: every channel stays dark.
  const channels = nav.match(/\d+/g)!.slice(0, 3).map(Number);
  expect(Math.max(...channels)).toBeLessThan(60);
});
