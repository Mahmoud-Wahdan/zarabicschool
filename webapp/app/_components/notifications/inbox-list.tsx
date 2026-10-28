"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { useBadge } from "./badge-provider";

import { Link } from "../../../i18n/navigation";
import Icon, { type IconName } from "../ui/icon";

/**
 * S-06 inbox (D12). One list, unread first; opening an item marks it read for this
 * user only. Titles come from the item kind — the inbox never carries names, phones,
 * amounts or message text.
 */
export type InboxListItem = { key: string; kind: string; href: string; read: boolean; createdAt: string };

const ICON: [RegExp, IconName][] = [
  [/^RENEWAL_/, "autorenew"],
  [/PAYMENT|BALANCE|SETTLED|OVERTIME/, "payments"],
  [/COMPLAINT/, "feedback"],
  [/APPLICATION/, "mark_email_unread"],
  [/TEACHER_PENDING/, "how_to_reg"],
  [/FLAG|LATE_START/, "flag"],
  [/SESSION_REQUEST/, "report_problem"],
  [/ANNOUNCEMENT|ADMIN_MESSAGE/, "campaign"],
  [/REPORT/, "description"],
  [/SESSION|SCHEDULE|SERIES|ATTENDANCE/, "event"],
];
const iconFor = (kind: string) => ICON.find(([pattern]) => pattern.test(kind))?.[1] ?? "notifications";

function markRead(body: object) {
  return fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
}

export default function InboxList({ items: initial, timeZone }: { items: InboxListItem[]; timeZone: string }) {
  const t = useTranslations("inbox");
  const locale = useLocale();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  // A5: the bell reads the same shared count; marking read updates it locally (no request).
  const badge = useBadge();
  const format = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" });
  const title = (kind: string) => (t.has(`kind.${kind}`) ? t(`kind.${kind}`) : t("kind.OTHER"));
  const unread = items.filter((item) => !item.read);
  const read = items.filter((item) => item.read);

  async function markAll() {
    setBusy(true);
    await markRead({ all: true });
    setItems((current) => current.map((item) => ({ ...item, read: true })));
    badge.markAllRead();
    setBusy(false);
  }

  function open(key: string) {
    void markRead({ keys: [key] });
    if (items.some((item) => item.key === key && !item.read)) badge.markRead(1);
    setItems((current) => current.map((item) => (item.key === key ? { ...item, read: true } : item)));
  }

  if (items.length === 0) {
    return <p className="rounded-xl border border-[var(--line)] bg-white p-6 text-sm opacity-75">{t("empty")}</p>;
  }

  const row = (item: InboxListItem) => (
    <li key={item.key}>
      <Link
        href={item.href}
        onClick={() => open(item.key)}
        className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--background)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--navy)] sm:px-5"
      >
        <Icon name={iconFor(item.kind)} size={20} className="mt-0.5 text-[var(--navy)]" />
        <span className="min-w-0 flex-1">
          <span className={`block text-sm ${item.read ? "opacity-70" : "font-semibold text-[var(--navy)]"}`}>{title(item.kind)}</span>
          <time dateTime={item.createdAt} className="mt-0.5 block text-xs tabular-nums opacity-65">{format.format(new Date(item.createdAt))}</time>
        </span>
        {item.read ? null : (
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--navy)]">
            <span className="sr-only">{t("unread")}</span>
          </span>
        )}
      </Link>
    </li>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" role="status">{unread.length ? t("unreadCount", { count: unread.length }) : t("allRead")}</p>
        {unread.length ? (
          <button type="button" disabled={busy} onClick={() => void markAll()} className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm text-[var(--navy)] hover:border-[var(--navy)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]">
            {t("markAll")}
          </button>
        ) : null}
      </div>
      {unread.length ? (
        <section aria-labelledby="inbox-unread">
          <h2 id="inbox-unread" className="mb-2 text-sm font-semibold text-[var(--navy)]">{t("newHeading")}</h2>
          <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)] bg-white">{unread.map(row)}</ul>
        </section>
      ) : null}
      {read.length ? (
        <section aria-labelledby="inbox-read">
          <h2 id="inbox-read" className="mb-2 text-sm font-semibold text-[var(--navy)]">{t("earlierHeading")}</h2>
          <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)] bg-white">{read.map(row)}</ul>
        </section>
      ) : null}
    </div>
  );
}
