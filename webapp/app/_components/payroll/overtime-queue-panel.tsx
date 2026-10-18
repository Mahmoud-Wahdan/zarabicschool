"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type OvertimeRow = {
  reportId: string;
  teacherName: string;
  studentName: string;
  sessionLabel: string;
  minutes: number;
  outcome: string;
};

/**
 * Admin-only overtime queue. Approve writes the per-minute adjustment (the route
 * does the money math server-side); reject records the decision only. PENDING-only
 * conditional updates make repeated clicks idempotent.
 */
export default function OvertimeQueuePanel({ initialRows }: { initialRows: OvertimeRow[] }) {
  const t = useTranslations("overtime");
  const [rows, setRows] = useState(initialRows);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function review(reportId: string, action: "APPROVE" | "REJECT") {
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch(`/api/reports/${reportId}/overtime`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error?.message ?? "ERROR");
        return;
      }
      setRows((current) => current.filter((row) => row.reportId !== reportId));
      setMessage(t("done"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p className="text-sm opacity-70">{t("empty")}</p>
      ) : (
        rows.map((row) => (
          <article key={row.reportId} className="rounded-xl border border-[var(--line)] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-semibold text-[var(--navy)]">
                  {row.teacherName} · {row.studentName} · {row.minutes} {t("colMinutes")}
                </p>
                <p className="mt-1 text-xs opacity-70">
                  {row.sessionLabel} · {row.outcome}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => void review(row.reportId, "APPROVE")} className="cta-primary rounded-lg px-3 py-2 text-xs disabled:opacity-50">
                  {t("approve")}
                </button>
                <button type="button" disabled={busy} onClick={() => void review(row.reportId, "REJECT")} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs disabled:opacity-50">
                  {t("reject")}
                </button>
              </div>
            </div>
          </article>
        ))
      )}
      <p className="text-xs opacity-60">{t("doneNote")}</p>
      {message ? <p role="status" className="text-sm opacity-75">{message}</p> : null}
    </div>
  );
}
