import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("../../i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import InboxList from "../../app/_components/notifications/inbox-list";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

/** S-06 inbox list: unread first with a screen-reader label, titles per kind in both languages, an empty state. */
const items = [
  { key: "JOB:1", kind: "RENEWAL_PAID", href: "/guardian/invoices", read: false, createdAt: "2026-10-28T08:00:00.000Z" },
  { key: "JOB:2", kind: "REPORT_SUBMITTED", href: "/guardian/sessions", read: true, createdAt: "2026-10-27T08:00:00.000Z" },
  { key: "JOB:3", kind: "SOMETHING_NEW", href: "/guardian", read: true, createdAt: "2026-10-26T08:00:00.000Z" },
];
const render = (locale: "ar" | "en", list = items) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en} timeZone="Africa/Cairo">
      <InboxList items={list} timeZone="Africa/Cairo" />
    </NextIntlClientProvider>,
  );

describe("inbox list", () => {
  it("INB-01: unread items come first under New, with a screen-reader 'Unread' label; earlier items after", () => {
    const html = render("en");
    expect(html.indexOf("Your package was renewed")).toBeLessThan(html.indexOf("A session report is ready"));
    expect(html.indexOf(">New<")).toBeLessThan(html.indexOf(">Earlier<"));
    expect(html.match(/class="sr-only">Unread</g)).toHaveLength(1);
    expect(html).toContain('href="/guardian/invoices"');
    expect(html).toContain("A notification from the academy"); // unknown kind falls back
  });

  it("INB-02: Arabic titles and the empty state", () => {
    expect(render("ar")).toContain("تم تجديد باقتك");
    expect(render("en", [])).toContain("Nothing new in the last two weeks.");
  });

  it("INB-03 (static): every job kind the worker composes has an inbox title in both languages", () => {
    const worker = readFileSync(join(process.cwd(), "lib/worker/notifications.ts"), "utf8");
    const kinds = [...new Set([...worker.matchAll(/job\.kind === "([A-Z_]+)"/g)].map((match) => match[1]))];
    expect(kinds.length).toBeGreaterThan(20);
    const missing = kinds.filter((kind) => !(kind in en.inbox.kind) || !(kind in ar.inbox.kind));
    expect(missing).toEqual([]);
  });
});
