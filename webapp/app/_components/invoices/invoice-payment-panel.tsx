"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

type Proof = {
  id: string;
  status: "PENDING" | "CONFIRMED" | "REJECTED";
  originalName: string;
  reference: string | null;
  createdAt: string;
};

/**
 * Payer actions on one PENDING invoice: Paymob hosted checkout (EGP; USD answers
 * NOT_CONFIGURED from the server and is surfaced as the localized unavailable note)
 * and the manual proof-upload fallback. Neither marks the invoice paid here — the
 * signed webhook or the Admin confirmation is authoritative.
 */
export default function InvoicePaymentPanel({ invoiceId, provider }: { invoiceId: string; provider: string }) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [proofs, setProofs] = useState<Proof[]>([]);

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

  async function uploadProof(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/proofs`, { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error?.message ?? t("actionFailed"));
        return;
      }
      setMessage(t("proofUploaded"));
      setProofs((current) => [
        ...current,
        {
          id: payload.data.id,
          status: "PENDING",
          originalName: form.get("file") instanceof File ? (form.get("file") as File).name : "",
          reference: (form.get("reference") as string) || null,
          createdAt: payload.data.createdAt,
        },
      ]);
      event.currentTarget.reset();
    } catch {
      setMessage(t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  const proofTone = (status: Proof["status"]) =>
    status === "CONFIRMED" ? t("proofConfirmed") : status === "REJECTED" ? t("proofRejected") : t("proofPending");

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

      <details className="rounded-xl border border-[var(--line)] p-3">
        <summary className="cursor-pointer text-sm font-semibold">{t("uploadProof")}</summary>
        <form onSubmit={uploadProof} className="mt-3 grid gap-3">
          <input type="file" name="file" required accept="image/jpeg,image/png,image/webp,application/pdf" className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm" aria-label={t("proofFileLabel")} />
          <input name="reference" placeholder={t("proofReference")} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
          <button type="submit" disabled={busy} className="cta-secondary justify-self-start rounded-lg px-3 py-2 text-sm disabled:opacity-50">
            {t("uploadProof")}
          </button>
        </form>
      </details>

      {proofs.length || message ? null : <p className="text-xs opacity-60">{t("proofNone")}</p>}
      {proofs.length ? (
        <ul className="space-y-1 text-xs opacity-80">
          {proofs.map((proof) => (
            <li key={proof.id}>
              {proof.originalName} · {proofTone(proof.status)}
              {proof.reference ? ` · ${proof.reference}` : ""}
              {" · "}
              {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(new Date(proof.createdAt))}
            </li>
          ))}
        </ul>
      ) : null}
      {message ? <p role="status" className="text-sm opacity-75">{message}</p> : null}
    </div>
  );
}
