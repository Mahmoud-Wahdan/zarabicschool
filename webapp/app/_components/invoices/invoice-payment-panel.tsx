"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

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
  const [message, setMessage] = useState("");

  async function pay() {
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/checkout`, { method: "POST" });
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
        <div className="space-y-2">
          <button type="button" disabled={busy} onClick={() => void pay()} className="cta-primary rounded-xl px-4 py-2 text-sm disabled:opacity-50">
            {t("payNow")}
          </button>
          <p className="text-xs opacity-70">{t("payNote")}</p>
        </div>
      ) : (
        <p className="rounded-xl border border-[var(--gold)]/40 bg-[var(--gold)]/10 p-3 text-xs opacity-80">{t("usdUnavailable")}</p>
      )}
      {message ? <p role="status" className="text-sm opacity-75">{message}</p> : null}
    </div>
  );
}
