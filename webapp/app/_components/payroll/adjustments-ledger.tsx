"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { formatMoney } from "../../../lib/payments/format";

/**
 * S-12 / D14 (Admin): every deduction and bonus, filtered by category; an entry is
 * corrected only by ONE opposite entry with a reason (append-only ledger).
 */
type Entry = { id: string; teacherName: string; amountMinor: number; currency: string; reason: string | null; category: string; createdAt: string; reversible: boolean };
const CATEGORIES = ["BONUS", "FINE", "OVERTIME", "OTHER", "UNCATEGORIZED"] as const;

export default function AdjustmentsLedger({ timeZone, refreshKey }: { timeZone: string; refreshKey: number }) {
  const t = useTranslations("payroll");
  const locale = useLocale();
  const [category, setCategory] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const format = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone, dateStyle: "medium" });

  const load = useCallback(async (filter: string) => {
    const response = await fetch(`/api/payroll/adjustments${filter ? `?category=${filter}` : ""}`);
    const payload = await response.json().catch(() => ({}));
    return response.ok ? (payload.data as Entry[]) : [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load(category).then((rows) => {
      if (!cancelled) setEntries(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [category, refreshKey, load]);

  async function reverse(id: string) {
    setMessage("");
    const response = await fetch(`/api/payroll/adjustments/${id}/reverse`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error?.code === "ALREADY_REVERSED" ? t("alreadyReversed") : payload.error?.message ?? t("reverseFailed"));
      return;
    }
    setReversing(null);
    setReason("");
    setMessage(t("reversed"));
    setEntries(await load(category));
  }

  return (
    <section className="z-card rounded-xl p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-semibold text-primary">{t("adjustmentsLedgerTitle")}</h2>
        <label className="grid gap-1 text-xs">
          <span className="text-on-surface-variant">{t("categoryFilter")}</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="z-input text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <option value="">{t("categoryAll")}</option>
            {CATEGORIES.map((value) => <option key={value} value={value}>{t(`category.${value}`)}</option>)}
          </select>
        </label>
      </div>
      {entries === null ? (
        <p className="mt-4 text-body-sm text-on-surface-variant">{t("loading")}</p>
      ) : entries.length === 0 ? (
        <p className="mt-4 text-body-sm text-on-surface-variant">{t("ledgerEmpty")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-start text-sm">
            <thead className="border-b border-outline-variant text-label-sm text-on-surface-variant">
              <tr>
                <th className="px-3 py-2 text-start">{t("colCreated")}</th>
                <th className="px-3 py-2 text-start">{t("teacherLabel")}</th>
                <th className="px-3 py-2 text-start">{t("categoryLabel")}</th>
                <th className="px-3 py-2 text-end">{t("colAmount")}</th>
                <th className="px-3 py-2 text-start">{t("reasonLabel")}</th>
                <th className="px-3 py-2 text-start"><span className="sr-only">{t("reverse")}</span></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-outline-variant align-top last:border-0">
                  <td className="px-3 py-3 tabular-nums text-on-surface-variant">{format.format(new Date(entry.createdAt))}</td>
                  <td className="px-3 py-3">{entry.teacherName}</td>
                  <td className="px-3 py-3">{t(`category.${entry.category}`)}</td>
                  <td className={`px-3 py-3 text-end font-semibold tabular-nums ${entry.amountMinor < 0 ? "text-[var(--status-danger)]" : ""}`}>{formatMoney(entry.amountMinor, entry.currency, locale)}</td>
                  <td className="max-w-xs px-3 py-3 text-on-surface-variant">{entry.reason ?? ""}</td>
                  <td className="px-3 py-3">
                    {entry.reversible ? (
                      reversing === entry.id ? (
                        <span className="flex flex-wrap gap-2">
                          <input value={reason} onChange={(event) => setReason(event.target.value)} minLength={2} aria-label={t("reverseReason")} placeholder={t("reverseReason")} className="w-44 rounded-lg border border-outline-variant px-2 py-1 text-xs" />
                          <button type="button" disabled={reason.trim().length < 2} onClick={() => void reverse(entry.id)} className="btn btn-primary px-3 py-1 text-xs disabled:opacity-50">{t("reverseConfirm")}</button>
                          <button type="button" onClick={() => { setReversing(null); setReason(""); }} className="rounded-lg px-2 py-1 text-xs underline-offset-4 hover:underline">{t("cancel")}</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => { setReversing(entry.id); setReason(""); }} className="btn btn-outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{t("reverse")}</button>
                      )
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {message ? <p role="status" className="mt-3 text-body-sm text-on-surface-variant">{message}</p> : null}
    </section>
  );
}
