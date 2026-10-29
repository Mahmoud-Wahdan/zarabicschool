"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * S-15 (D74): the payer asks the academy to refund a paid card payment. No reason and
 * no session count (owner, 2026-10-29): one confirm step, then the academy decides.
 * One open request per invoice; after a rejection the reason shows and they may ask again.
 */
export default function RefundRequestButton({ invoiceId, latest }: { invoiceId: string; latest: { status: string; rejectionReason: string | null } | null }) {
  const t = useTranslations("invoices");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function send() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/refund-request`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const payload = await response.json().catch(() => ({}));
      const code = payload.error?.code;
      if (response.ok || code === "REQUEST_ALREADY_OPEN") {
        setConfirming(false);
        router.refresh();
        return;
      }
      setMessage(code === "NOT_REFUNDABLE" ? t("refundRequestNotRefundable") : t("refundRequestFailed"));
    } catch {
      setMessage(t("refundRequestFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (latest?.status === "PENDING") {
    return <p role="status" className="mt-4 text-sm text-primary">{t("refundRequestSent")}</p>;
  }
  if (latest?.status === "APPROVED") {
    return <p role="status" className="mt-4 text-sm text-primary">{t("refundRequestApproved")}</p>;
  }

  return (
    <div className="mt-4 space-y-2">
      {latest?.status === "REJECTED" ? (
        <p className="text-sm">
          {t("refundRequestRejected")}
          {latest.rejectionReason ? <span className="block text-on-surface-variant">{t("refundRequestReason", { reason: latest.rejectionReason })}</span> : null}
        </p>
      ) : null}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm">{t("refundRequestConfirmText")}</p>
          <button type="button" disabled={busy} aria-busy={busy} onClick={() => void send()} className="btn btn-primary disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{t("refundRequestConfirm")}</button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-xl px-4 py-2 text-sm text-primary underline-offset-4 hover:underline">{t("refundCancel")}</button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="btn btn-outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{t("refundRequest")}</button>
      )}
      {message ? <p role="status" className="text-body-sm text-on-surface-variant">{message}</p> : null}
    </div>
  );
}
