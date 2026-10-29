"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

/**
 * S-13 (c) / D42: Admin partial refund by sessions. The amount shown is the same
 * formula the server applies (floor(sessions × amount ÷ sessions bought)); the server
 * re-checks every limit. One Idempotency-Key per attempt, kept until the attempt is
 * answered, so a retried click can never refund twice.
 */
export default function RefundForm({ invoiceId, amountMinor, currency, sessionsPurchased, timeZone, refundRequestId, onDone }: { invoiceId: string; amountMinor: string; currency: string; sessionsPurchased: number; timeZone: string; refundRequestId?: string; onDone?: () => void }) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState("1");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // S-07 (Q3): upcoming sessions that hold this package's credit (remove the student first).
  const [held, setHeld] = useState<{ id: string; scheduledStart: string }[]>([]);
  const count = Number(sessions);
  const valid = Number.isInteger(count) && count > 0 && count <= sessionsPurchased && reason.trim().length >= 5;
  const preview = valid ? (BigInt(count) * BigInt(amountMinor)) / BigInt(sessionsPurchased) : null;
  const money = (minor: bigint) => new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(Number(minor) / 100);

  async function submit() {
    const attemptKey = key ?? crypto.randomUUID();
    setKey(attemptKey);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/refunds`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": attemptKey },
        // S-15: a refund answering a payer's request carries its id (the request becomes APPROVED).
        body: JSON.stringify({ sessions: count, reason: reason.trim(), ...(refundRequestId ? { refundRequestId } : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      const code = payload.error?.code;
      setHeld(Array.isArray(payload.error?.reservedSessions) ? payload.error.reservedSessions : []);
      setMessage(
        response.status === 201 || response.status === 200
          ? t("refundDone")
          : response.status === 202
            ? t("refundPending")
            : code === "NOT_ENOUGH_CREDIT"
              ? t("refundNoCredit")
              : code === "REFUND_EXCEEDS_PAID"
                ? t("refundOverPaid")
                : t("refundFailed"),
      );
      // Any answer closes this attempt; the next refund gets a new key.
      setKey(null);
      if (response.ok) {
        setReason("");
        setOpen(false);
        onDone?.();
      }
    } catch {
      // Network error: the same key is kept, so a retry is safe.
      setMessage(t("refundFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setOpen(true)} className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm text-[var(--navy)] hover:border-[var(--navy)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]">{t("refund")}</button>
        {message ? <p role="status" className="text-sm opacity-80">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-[var(--line)] bg-[var(--background)] p-4">
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-[var(--navy)]">{t("refundSessions")}</span>
          <input type="number" min={1} max={sessionsPurchased} step={1} value={sessions} onChange={(event) => setSessions(event.target.value)} className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-[var(--navy)]">{t("refundReason")}</span>
          <input value={reason} minLength={5} maxLength={1000} onChange={(event) => setReason(event.target.value)} className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]" />
        </label>
      </div>
      <p className="text-sm">{preview !== null ? t("refundPreview", { amount: money(preview), sessions: count }) : t("refundHint")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!valid || busy} aria-busy={busy} onClick={() => void submit()} className="cta-primary rounded-xl px-4 py-2 text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]">{t("refundConfirm")}</button>
        <button type="button" disabled={busy} onClick={() => { setOpen(false); setMessage(""); }} className="rounded-xl px-4 py-2 text-sm text-[var(--navy)] underline-offset-4 hover:underline">{t("refundCancel")}</button>
      </div>
      {message ? <p role="status" className="text-sm opacity-80">{message}</p> : null}
      {held.length ? (
        <div className="text-sm">
          <p>{t("refundHeldSessions")}</p>
          <ul className="mt-1 list-disc ps-5">
            {held.map((session) => (
              <li key={session.id}>
                <a href={`/${locale}/admin/sessions/${session.id}`} className="text-[var(--navy)] underline underline-offset-4">
                  {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(session.scheduledStart))}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
