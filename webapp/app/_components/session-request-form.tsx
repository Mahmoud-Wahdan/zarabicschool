"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * "أبلغ عن عطل" — the outage/absence request form for one session, used by
 * Teacher, Student and Guardian session lists (Batch C). The API enforces the
 * role authorization, the rate limit and one open request per (session, requester).
 */
export default function SessionRequestForm({ sessionId }: { sessionId: string }) {
  const t = useTranslations("sessionRequest");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/sessions/${sessionId}/session-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setBusy(false);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error?.message ?? t("errorGeneric"));
      return;
    }
    setMessage(t("submitted"));
    setReason("");
  }

  return (
    <div className="mt-3">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="btn btn-soft text-xs">
          {t("open")}
        </button>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg bg-surface-container-low p-3">
          <label className="text-label-sm font-semibold text-on-surface" htmlFor={`reason-${sessionId}`}>
            {t("reasonLabel")}
          </label>
          <textarea
            id={`reason-${sessionId}`}
            required
            minLength={2}
            maxLength={1000}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("reasonPlaceholder")}
            className="z-textarea"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn btn-primary text-xs">
              {busy ? t("sending") : t("send")}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-soft text-xs">
              {t("cancel")}
            </button>
          </div>
          {message ? <p role="status" className="text-body-sm text-secondary">{message}</p> : null}
          {error ? <p role="alert" className="text-body-sm text-error">{error}</p> : null}
        </form>
      )}
    </div>
  );
}
