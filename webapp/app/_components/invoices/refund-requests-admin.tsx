"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import RefundForm from "./refund-form";

type Row = {
  id: string;
  createdAt: string;
  requestedBy: string;
  invoice: { id: string; amountMinor: string; currency: string; sessionsPurchased: number; paidAt: string | null; studentName: string };
};

/**
 * S-15 (D74): payers' waiting refund requests on the Admin invoices page. "Refund"
 * opens the existing S-13c refund form linked to the request (it becomes APPROVED
 * when the refund is sent); "Reject" needs a reason, which the payer receives.
 */
export default function RefundRequestsAdmin({ requests, timeZone }: { requests: Row[]; timeZone: string }) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const router = useRouter();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const date = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" });
  const money = (minor: string, currency: string) => new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(Number(minor) / 100);

  async function reject(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/refund-requests/${id}/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }) });
      if (!response.ok) {
        setMessage(t("refundRequestRejectFailed"));
        return;
      }
      setRejecting(null);
      setReason("");
      router.refresh();
    } catch {
      setMessage(t("refundRequestRejectFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="z-card rounded-xl p-5" aria-labelledby="refund-requests-title">
      <h2 id="refund-requests-title" className="font-semibold text-primary">{t("refundRequestsTitle")}</h2>
      {requests.length === 0 ? (
        <p className="mt-2 text-body-sm text-on-surface-variant">{t("refundRequestsEmpty")}</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {requests.map((request) => (
            <li key={request.id} className="rounded-lg border border-outline-variant p-4">
              <p className="text-sm font-semibold text-primary">{request.invoice.studentName}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                {t("refundRequestMeta", { payer: request.requestedBy, amount: money(request.invoice.amountMinor, request.invoice.currency), date: date.format(new Date(request.createdAt)) })}
              </p>
              {rejecting === request.id ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="grid flex-1 gap-1 text-sm">
                    <span className="font-medium text-primary">{t("refundRequestRejectReason")}</span>
                    <input value={reason} minLength={2} maxLength={1000} onChange={(event) => setReason(event.target.value)} className="z-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
                  </label>
                  <button type="button" disabled={busy || reason.trim().length < 2} aria-busy={busy} onClick={() => void reject(request.id)} className="btn btn-outline text-primary disabled:opacity-50">{t("refundRequestRejectConfirm")}</button>
                  <button type="button" disabled={busy} onClick={() => setRejecting(null)} className="rounded-xl px-4 py-2 text-sm text-primary underline-offset-4 hover:underline">{t("refundCancel")}</button>
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap items-start gap-3">
                  <RefundForm timeZone={timeZone} invoiceId={request.invoice.id} amountMinor={request.invoice.amountMinor} currency={request.invoice.currency} sessionsPurchased={request.invoice.sessionsPurchased} refundRequestId={request.id} onDone={() => router.refresh()} />
                  <button type="button" onClick={() => { setRejecting(request.id); setReason(""); }} className="mt-4 rounded-xl px-4 py-2 text-sm text-primary underline-offset-4 hover:underline">{t("refundRequestReject")}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {message ? <p role="status" className="mt-3 text-body-sm text-on-surface-variant">{message}</p> : null}
    </section>
  );
}
