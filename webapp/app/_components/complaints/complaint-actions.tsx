"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Admin/Supervisor workflow buttons: NEW → IN_PROGRESS → RESOLVED (+ required
 * resolution note). The concerned party is informed manually — nothing is sent.
 */
export default function ComplaintActions({ complaintId, status }: { complaintId: string; status: "NEW" | "IN_PROGRESS" | "RESOLVED" }) {
  const t = useTranslations("complaintsAdmin");
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/complaints/${complaintId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error?.message ?? t("actionError"));
        return;
      }
      router.refresh();
    } catch {
      setMessage(t("actionError"));
    } finally {
      setBusy(false);
    }
  }

  if (status === "RESOLVED") return null;
  return (
    <section className="z-card mt-4 flex flex-col gap-3 rounded-xl p-4">
      <p className="text-body-sm text-on-surface-variant">{t("manualInformHint")}</p>
      {status === "NEW" ? (
        <button type="button" disabled={busy} onClick={() => send({ action: "START" })} className="btn btn-primary self-start px-3 py-2 text-sm disabled:opacity-50">
          {t("startAction")}
        </button>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send({ action: "RESOLVE", resolutionNote: note });
          }}
        >
          <label className="flex flex-col gap-1 text-label-md font-semibold text-on-surface">
            {t("resolutionNoteLabel")}
            <textarea required minLength={2} maxLength={4000} rows={4} value={note} onChange={(event) => setNote(event.target.value)} className="z-input" />
          </label>
          <button type="submit" disabled={busy} className="btn btn-primary self-start px-3 py-2 text-sm disabled:opacity-50">
            {t("resolveAction")}
          </button>
        </form>
      )}
      {message ? <p role="alert" className="text-body-sm text-on-error-container">{message}</p> : null}
    </section>
  );
}
