import { readFileSync } from "node:fs";

import { test as base, expect, type APIRequestContext, type APIResponse, type BrowserContext, type Page, type Response } from "@playwright/test";

import { BASE_URL, clientIp, statePath, type RoleKey } from "./run";

export { expect };
export type Who = RoleKey | "anon";
export type Locale = "ar" | "en";

const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
const ar = JSON.parse(readFileSync("messages/ar.json", "utf8"));
export const messages = { en, ar } as const;

/** "namespace.key" left on screen = a missing translation (next-intl prints the key path). */
const MISSING_KEY = new RegExp(`\\b(?:${Object.keys(en).join("|")})\\.[A-Za-z][\\w.]*\\b|MISSING_MESSAGE`);

const pageErrors = new WeakMap<Page, string[]>();
/** Uncaught exceptions thrown in the page since it opened. */
export const errorsOf = (page: Page) => pageErrors.get(page) ?? [];

type Opener = (
  who: Who,
  options?: { locale?: Locale; browserLocale?: string; ip?: string; javaScriptEnabled?: boolean },
) => Promise<Page>;
type ApiOpener = (who: Who, options?: { ip?: string; origin?: string | null }) => Promise<APIRequestContext>;

export const test = base.extend<{ open: Opener; api: ApiOpener }>({
  /** A page signed in as `who` (browser state from auth.setup.ts), from that role's own client address. */
  open: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async (who, options = {}) => {
      const context = await browser.newContext({
        storageState: who === "anon" ? undefined : statePath(who),
        extraHTTPHeaders: { "x-forwarded-for": options.ip ?? clientIp(`page-${who}`) },
        locale: options.browserLocale ?? (options.locale === "ar" ? "ar-EG" : "en-US"),
        timezoneId: "Africa/Cairo",
        javaScriptEnabled: options.javaScriptEnabled ?? true,
      });
      contexts.push(context);
      const page = await context.newPage();
      const errors: string[] = [];
      pageErrors.set(page, errors);
      page.on("pageerror", (error) => errors.push(error.message));
      // A blocked script/style/connection (the CSP) counts as a page error too.
      page.on("console", (message) => {
        if (message.type() === "error" && /Content Security Policy/i.test(message.text())) errors.push(message.text());
      });
      return page;
    });
    for (const context of contexts) await context.close();
  },
  /** An HTTP client with `who`'s session cookie and, unless null, the app's own Origin. */
  api: async ({ playwright }, provide) => {
    const contexts: APIRequestContext[] = [];
    await provide(async (who, options = {}) => {
      const origin = options.origin === undefined ? BASE_URL : options.origin;
      const context = await playwright.request.newContext({
        baseURL: BASE_URL,
        storageState: who === "anon" ? undefined : statePath(who),
        extraHTTPHeaders: {
          "x-forwarded-for": options.ip ?? clientIp(`api-${who}`),
          ...(origin ? { origin } : {}),
        },
      });
      contexts.push(context);
      return context;
    });
    for (const context of contexts) await context.dispose();
  },
});

const WINDOW_MS = 61_000;

/** page.goto that waits out the app's 120 requests/min/client limit instead of failing on it. */
export async function visit(page: Page, path: string): Promise<Response | null> {
  for (let attempt = 0; ; attempt++) {
    const response = await page.goto(path, { waitUntil: "load" });
    if (response?.status() !== 429 || attempt === 2) return response;
    await page.waitForTimeout(WINDOW_MS);
  }
}

/** The same for API calls (one retry after the window). */
export async function call(send: () => Promise<APIResponse>): Promise<APIResponse> {
  const first = await send();
  if (first.status() !== 429) return first;
  await new Promise((resolve) => setTimeout(resolve, WINDOW_MS));
  return send();
}

/**
 * A page that rendered properly: right lang/dir, a heading, no error boundary, no 404
 * view, no raw translation key, no uncaught exception. Soft, so one page's problem does
 * not hide the next page's in a crawl.
 */
export async function expectHealthyPage(page: Page, locale: Locale, label = page.url()) {
  const html = page.locator("html");
  await expect.soft(html, `${label}: lang`).toHaveAttribute("lang", locale);
  await expect.soft(html, `${label}: dir`).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  await expect.soft(page.locator("h1").first(), `${label}: heading`).toBeVisible();
  const body = await page.locator("body").innerText();
  expect.soft(body, `${label}: error boundary`).not.toContain(messages[locale].common.errorTitle);
  expect.soft(body, `${label}: 404 view`).not.toContain(messages[locale].notFound.title);
  expect.soft(body.match(MISSING_KEY)?.[0] ?? null, `${label}: untranslated key`).toBeNull();
  expect.soft(errorsOf(page), `${label}: uncaught page errors`).toEqual([]);
}
