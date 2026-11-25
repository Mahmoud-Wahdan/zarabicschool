"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

/**
 * Payer actions on one PENDING invoice: Paymob hosted checkout (EGP; USD answers
 * NOT_CONFIGURED from the server and is surfaced as the localized unavailable note).
 * The checkout never marks the invoice paid here — the signed webhook is authoritative.
 *
 * MANUAL-PAYMENT UI HIDE (owner decision 2026-10-24 — docs/specs/phase-06-financial-management.md
 * § Session 3, Slice A): the manual proof-upload fallback is hidden from the UI. The API stays
 * reachable with unchanged authorization ("dormant but reachable"):
 *   POST /api/invoices/[id]/proofs   (STUDENT adult-without-guardian / GUARDIAN, finance wall enforced)
 * The removed upload form lives in git history at this commit.
 */
export default function InvoicePaymentPanel({ invoiceId, provider }: { invoiceId: string; provider: string }) {
  const t = useTranslations("invoices");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState("");

  async function pay() {
    if (!consent) return;
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.checkoutUrl) {
        setMessage(
          payload.error?.code === "NOT_CONFIGURED"
            ? t("usdUnavailable")
            : payload.error?.message ?? t("payFailed"),
        );
        return;
      }
      setMessage(t("redirecting"));
      window.location.href = payload.checkoutUrl as string;
    } catch {
      setMessage(t("payFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {provider === "PAYMOB" ? (
        <div className="space-y-3">
          <label className="flex items-start gap-2.5 text-body-sm text-on-surface cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
            <span>
              {t("termsConsentPrefix")}{" "}
              <Link href="/terms" target="_blank" className="font-semibold text-primary underline">
                {t("termsLink")}
              </Link>{" "}
              {t("termsConsentAnd")}{" "}
              <Link href="/refund-policy" target="_blank" className="font-semibold text-primary underline">
                {t("refundLink")}
              </Link>
              .
            </span>
          </label>
          <button type="button" disabled={busy || !consent} onClick={() => void pay()} className="btn btn-primary disabled:opacity-50">
            {t("payNow")}
          </button>
          <p className="text-label-sm text-on-surface-variant">{t("payNote")}</p>
        </div>
      ) : (
        <p className="rounded-xl border border-tertiary-container bg-tertiary-fixed/40 p-3 text-label-sm text-on-surface-variant">{t("usdUnavailable")}</p>
      )}
      {message ? <p role="status" className="text-body-sm text-on-surface-variant">{message}</p> : null}
    </div>
  );
}
