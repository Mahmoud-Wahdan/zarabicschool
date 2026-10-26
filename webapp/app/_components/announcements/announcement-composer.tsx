"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

type Summary = { activeUsers: number; whatsappRecipients: number; withoutPhone: number; optedOut: number; sharedNumbersMerged: number };

/**
 * Two-step composer (owner, 2026-10-26): write → "Review recipients" fetches the
 * server's count → explicit confirmation sends. The server re-counts and refuses
 * (409 RECIPIENTS_CHANGED) when the confirmed count is stale. A sent announcement
 * cannot be edited.
 */
export default function AnnouncementComposer({ defaultExpiryDays, maxPerDay }: { defaultExpiryDays: number; maxPerDay: number }) {
  const t = useTranslations("announcementsAdmin");
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function review() {
    setBusy(true);
    setMessage("");
    setConfirmed(false);
    try {
      const response = await fetch("/api/announcements/recipients");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error?.message ?? t("error"));
        return;
      }
      setSummary(payload.data);
    } catch {
      setMessage(t("error"));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!summary || !confirmed) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/announcements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          ...(expiresOn ? { expiresAt: new Date(`${expiresOn}T23:59:59`).toISOString() } : {}),
          confirmRecipientCount: summary.whatsappRecipients,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload.error?.code === "RECIPIENTS_CHANGED") {
        setSummary((current) => (current ? { ...current, whatsappRecipients: payload.data?.whatsappRecipients ?? current.whatsappRecipients } : current));
        setConfirmed(false);
        setMessage(t("recipientsChanged"));
        return;
      }
      if (response.status === 429 && payload.error?.code === "ANNOUNCEMENT_DAILY_LIMIT") {
        setMessage(t("dailyLimit", { count: maxPerDay }));
        return;
      }
      if (!response.ok) {
        setMessage(payload.error?.message ?? t("error"));
        return;
      }
      setTitle("");
      setBody("");
      setExpiresOn("");
      setSummary(null);
      setConfirmed(false);
      setMessage(t("sent"));
      router.refresh();
    } catch {
      setMessage(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="z-card flex flex-col gap-3 rounded-xl p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void (summary ? send() : review());
      }}
    >
      <label className="flex flex-col gap-1 text-label-md font-semibold text-on-surface">
        {t("titleLabel")}
        <input required minLength={2} maxLength={200} value={title} onChange={(event) => { setTitle(event.target.value); setConfirmed(false); }} className="z-input" />
      </label>
      <label className="flex flex-col gap-1 text-label-md font-semibold text-on-surface">
        {t("bodyLabel")}
        <textarea required minLength={2} maxLength={2000} rows={6} value={body} onChange={(event) => { setBody(event.target.value); setConfirmed(false); }} className="z-input" />
      </label>
      <label className="flex flex-col gap-1 text-label-md font-semibold text-on-surface">
        {t("expiryLabel")}
        <input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} className="z-input" />
        <span className="text-label-sm font-normal text-on-surface-variant">{t("expiryHint", { days: defaultExpiryDays })}</span>
      </label>
      <p className="text-label-sm text-on-surface-variant">{t("dailyLimitHint", { count: maxPerDay })}</p>

      {summary ? (
        <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-body-sm">
          <p className="font-semibold text-primary">{t("recipientCount", { count: summary.whatsappRecipients })}</p>
          <p className="text-on-surface-variant">
            {t("recipientDetail", { users: summary.activeUsers, noPhone: summary.withoutPhone, merged: summary.sharedNumbersMerged })}
          </p>
          <p className="text-on-surface-variant">{t("recipientScope", { optedOut: summary.optedOut })}</p>
          <label className="mt-2 flex items-start gap-2">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>{t("confirmLabel", { count: summary.whatsappRecipients })}</span>
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {summary ? (
          <>
            <button type="submit" disabled={busy || !confirmed} className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50">
              {t("sendAction")}
            </button>
            <button type="button" disabled={busy} onClick={() => { setSummary(null); setConfirmed(false); }} className="btn btn-soft px-4 py-2 text-sm">
              {t("editAction")}
            </button>
          </>
        ) : (
          <button type="submit" disabled={busy} className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50">
            {t("reviewAction")}
          </button>
        )}
      </div>
      {message ? <p role="status" className="text-body-sm text-on-surface-variant">{message}</p> : null}
    </form>
  );
}
