"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import DataTable, { type DataRow } from "../ui/data-table";

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
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function review(reportId: string, action: "APPROVE" | "REJECT") {
    setMessage(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/reports/${reportId}/overtime`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        setMessage({ tone: "error", text: t("failed") });
        return;
      }
      setRows((current) => current.filter((row) => row.reportId !== reportId));
      setMessage({ tone: "success", text: t("done") });
    } catch {
      setMessage({ tone: "error", text: t("failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="z-card overflow-hidden rounded-xl pt-4 sm:pt-6" aria-label={t("title")}>
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mx-4 mb-3 rounded-lg px-3 py-2 text-body-sm sm:mx-6 ${message.tone === "success" ? "bg-secondary-fixed/30 text-on-surface" : "bg-error-container/60 text-on-error-container"}`}>
          {message.text}
        </p>
      ) : null}
      <DataTable
        caption={t("title")}
        columns={[
          { key: "teacher", label: t("colTeacher") },
          { key: "student", label: t("colStudent") },
          { key: "session", label: t("colSession") },
          { key: "minutes", label: t("colMinutes") },
          { key: "outcome", label: t("colOutcome") },
        ]}
        rows={rows.map((row): DataRow => ({
          id: row.reportId,
          cells: {
            teacher: { text: row.teacherName, strong: true },
            student: { text: row.studentName },
            session: { text: row.sessionLabel },
            minutes: { text: String(row.minutes), sort: row.minutes, numeric: true },
            outcome: { text: row.outcome },
          },
        }))}
        emptyTitle={t("empty")}
        emptyIcon="task_alt"
        actions={{
          label: t("colActions"),
          render: (id) => (
            <>
              <button type="button" disabled={busy} onClick={() => void review(id, "APPROVE")} className="btn btn-primary">{t("approve")}</button>
              <button type="button" disabled={busy} onClick={() => void review(id, "REJECT")} className="btn btn-ghost-danger">{t("reject")}</button>
            </>
          ),
        }}
      />
      <p className="border-t border-outline-variant px-4 py-3 text-label-sm text-on-surface-variant sm:px-6">{t("doneNote")}</p>
    </section>
  );
}
