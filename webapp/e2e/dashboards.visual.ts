import { mkdirSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";

const roles = ["admin", "supervisor", "teacher", "student", "guardian"] as const;
const root = "docs/dashboard-review";
const base = process.env.NEXTAUTH_URL!;

async function signIn(request: APIRequestContext, username: string, password: string) {
  const { csrfToken } = await (await request.get("/api/auth/csrf")).json();
  await request.post("/api/auth/callback/credentials", { form: { csrfToken, username, password, json: "true" } });
  return (await (await request.get("/api/auth/session")).json()).user;
}

for (const role of roles) {
  test.describe(role, () => {
    const state = `e2e/.run/${role}-browser.json`;
    test.beforeAll(async ({ playwright }) => {
      mkdirSync(root, { recursive: true });
      const request = await playwright.request.newContext({ baseURL: base });
      try {
        const username = role === "admin" ? process.env.SEED_ADMIN_USERNAME! : "demo_" + role;
        let user = await signIn(request, username, role === "admin" ? process.env.QA_ADMIN_PASSWORD! : process.env.SEED_DEMO_PASSWORD!);
        if (role === "admin" && !user) {
          user = await signIn(request, username, process.env.SEED_ADMIN_PASSWORD!);
          expect(user?.mustChangePassword).toBe(true);
          const password = process.env.QA_ADMIN_PASSWORD!;
          const response = await request.post("/api/auth/change-password", { headers: { origin: base },
            data: { currentPassword: process.env.SEED_ADMIN_PASSWORD, newPassword: password, confirmPassword: password } });
          expect(response.ok()).toBeTruthy();
          user = await signIn(request, username, password);
        }
        expect(user.role).toBe(role.toUpperCase());
        expect(user.mustChangePassword).toBe(false);
        await request.storageState({ path: state });
      } finally { await request.dispose(); }
    });
    test.use({ storageState: state });
    for (const locale of ["en", "ar"]) {
      test(`${locale} responsive dashboard and activity`, async ({ page }) => {
        await page.goto(`/${locale}/${role}`);
        const table = page.locator(".activity-table");
        await expect(table).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
        for (const width of [390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(() => document.fonts.ready);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.screenshot({ path: `${root}/${role}-${locale}-${width}.png`, animations: "disabled", style: "nextjs-portal {display:none}" });
        }
        expect((await new AxeBuilder({ page }).include(".activity-panel").analyze()).violations.map(v => v.id)).toEqual([]);
        if (role === "student") await expect(page.locator('a[href$="/student/invoices"]')).toHaveCount(0);
        if (role === "supervisor") await expect(page.locator('a[href$="/admin/payroll"], a[href$="/admin/invoices"]')).toHaveCount(0);
        const month = await page.locator("#activity-month option").nth(1).getAttribute("value");
        await page.locator("#activity-month").selectOption(month!);
        await page.locator("form:has(#activity-month) button").click();
        await expect(page).toHaveURL(new RegExp("activity=" + month));
        await expect(table).toBeVisible();
        if (role !== "admin") {
          await page.goto(`/${locale}/admin/payroll`);
          await expect(page).toHaveURL(new RegExp(`/${locale}/${role}$`));
        }
      });
    }

    if (role === "admin") test("academy counts match independent fixture SQL", async ({ page }) => {
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      try {
        await page.goto("/en/admin");
        const month = await page.locator("#activity-month").inputValue();
        const { rows } = await db.query(`SELECT count(*) FILTER (WHERE status <> 'CANCELLED')::int AS total,
          count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed FROM sessions
          WHERE to_char(scheduled_start AT TIME ZONE 'Africa/Cairo','YYYY-MM') = $1`, [month]);
        const cells = page.locator(".activity-table tbody tr");
        await expect(cells.nth(0).locator("td").first()).toHaveText(String(rows[0].total));
        await expect(cells.nth(1).locator("td").first()).toHaveText(String(rows[0].completed));
      } finally { await db.end(); }
    });
  });
}
