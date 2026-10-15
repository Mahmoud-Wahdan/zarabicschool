"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import ReportAttachments, { type AttachmentItem } from "./report-attachments";

export type ExistingReport = {
  id: string;
  status: "SUBMITTED" | "REJECTED" | "APPROVED" | "ARCHIVED";
  attendanceOutcome: "ATTENDED" | "STUDENT_ABSENT";
  classRemark: string;
  summary: string;
  homework: string;
  notes: string;
  extraTimeMinutes: number;
  operationalEvents: string;
  rejectionReason: string | null;
};

/**
 * Per-student session report (mobile-first, RTL-first). Editing is allowed only
 * while the report is missing or REJECTED; SUBMITTED shows a waiting state and
 * APPROVED/ARCHIVED are read-only. The attendance outcome and the claimed extra
 * time are frozen from the first submission (owner decision 2026-10-14).
 */
export default function ReportForm({
  sessionId,
  studentId,
  classRemarks,
  initial,
  attachments,
}: {
  sessionId: string;
  studentId: string;
  classRemarks: string[];
  initial: ExistingReport | null;
  attachments: AttachmentItem[];
}) {
  const t = useTranslations("teacherReport");
  const editable = initial === null || initial.status === "REJECTED";
  const [currentId, setCurrentId] = useState<string | null>(initial?.id ?? null);
  const [form, setForm] = useState({
    attendanceOutcome: initial?.attendanceOutcome ?? "ATTENDED",
    classRemark: initial?.classRemark ?? "",
    summary: initial?.summary ?? "",
    homework: initial?.homework ?? "",
    notes: initial?.notes ?? "",
    extraTimeMinutes: initial?.extraTimeMinutes ?? 0,
    operationalEvents: initial?.operationalEvents ?? "",
  });
  const [status, setStatus] = useState(initial?.status ?? null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    let operationalEvents: Record<string, unknown> | undefined;
    if (form.operationalEvents.trim()) {
      try {
        const parsed = JSON.parse(form.operationalEvents);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          setError(t("operationalEventsInvalid"));
          return;
        }
        operationalEvents = parsed;
      } catch {
        setError(t("operationalEventsInvalid"));
        return;
      }
    }
    setSaving(true);
    const response = await fetch(`/api/sessions/${sessionId}/students/${studentId}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, operationalEvents }),
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? t("errorGeneric"));
      return;
    }
    setStatus("SUBMITTED");
    if (payload?.data?.id) setCurrentId(payload.data.id);
    setMessage(t("submittedMessage"));
  }

  if ((status === "APPROVED" || status === "ARCHIVED") && currentId) {
    return (
      <div className="mt-5 flex flex-col gap-4">
        <p className="rounded-lg bg-secondary-container px-4 py-3 text-body-md text-on-secondary-container">{t("approvedReadOnly")}</p>
        <ReportAttachments reportId={currentId} initial={attachments} editable={false} />
      </div>
    );
  }

  if (status === "SUBMITTED" && currentId && !editable) {
    return (
      <div className="mt-5 flex flex-col gap-4">
        <p className="rounded-lg bg-surface-container-high px-4 py-3 text-body-md text-on-surface-variant">{t("awaitingReview")}</p>
        <ReportAttachments reportId={currentId} initial={attachments} editable />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="z-card mt-5 flex flex-col gap-4 rounded-xl p-4 sm:p-5">
      {initial?.status === "REJECTED" ? (
        <div className="flex flex-col gap-1 rounded-lg bg-error-container px-4 py-3 text-on-error-container">
          <p className="text-body-md font-bold">{t("rejectedBanner")}</p>
          <p className="text-body-sm">{initial.rejectionReason}</p>
          <p className="text-label-sm opacity-80">{t("rejectedHint")}</p>
        </div>
      ) : null}

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">{t("attendance")}</span>
        <select
          value={form.attendanceOutcome}
          disabled={!editable}
          onChange={(event) => setForm({ ...form, attendanceOutcome: event.target.value as ExistingReport["attendanceOutcome"] })}
          className="z-input w-full"
        >
          <option value="ATTENDED">{t("attended")}</option>
          <option value="STUDENT_ABSENT">{t("absent")}</option>
        </select>
        <span className="text-label-sm text-on-surface-variant">{t("frozenHint")}</span>
      </label>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">{t("classRemark")}</span>
        <select
          required
          value={form.classRemark}
          disabled={!editable}
          onChange={(event) => setForm({ ...form, classRemark: event.target.value })}
          className="z-input w-full"
        >
          <option value="" disabled>
            — {t("classRemark")} —
          </option>
          {classRemarks.map((remark) => (
            <option key={remark} value={remark}>
              {remark}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">{t("summary")}</span>
        <textarea
          required
          minLength={2}
          maxLength={5000}
          disabled={!editable}
          value={form.summary}
          onChange={(event) => setForm({ ...form, summary: event.target.value })}
          className="z-textarea min-h-28 w-full"
        />
      </label>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">{t("homework")}</span>
        <textarea
          required
          maxLength={5000}
          disabled={!editable}
          value={form.homework}
          onChange={(event) => setForm({ ...form, homework: event.target.value })}
          className="z-textarea min-h-24 w-full"
        />
        <span className="text-label-sm text-on-surface-variant">{t("homeworkHint")}</span>
      </label>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">
          {t("notes")} <span className="font-normal text-on-surface-variant">({t("optional")})</span>
        </span>
        <textarea
          maxLength={5000}
          disabled={!editable}
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          className="z-textarea min-h-20 w-full"
        />
      </label>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">{t("extraTime")}</span>
        <input
          type="number"
          min={0}
          max={600}
          disabled={!editable}
          value={form.extraTimeMinutes}
          onChange={(event) => setForm({ ...form, extraTimeMinutes: Number(event.target.value) })}
          className="z-input w-full"
        />
        <span className="text-label-sm text-on-surface-variant">{t("extraTimeHint")}</span>
      </label>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">
          {t("operationalEvents")} <span className="font-normal text-on-surface-variant">({t("optional")})</span>
        </span>
        <textarea
          disabled={!editable}
          value={form.operationalEvents}
          onChange={(event) => setForm({ ...form, operationalEvents: event.target.value })}
          placeholder='{"late_entry_minutes": 5}'
          className="z-textarea min-h-20 w-full font-mono text-xs"
        />
        <span className="text-label-sm text-on-surface-variant">{t("operationalEventsHint")}</span>
      </label>

      {currentId ? <ReportAttachments reportId={currentId} initial={attachments} editable={editable} /> : null}

      {error ? (
        <p role="alert" className="rounded-lg bg-error-container px-3.5 py-2.5 text-body-sm text-on-error-container">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-lg bg-secondary-container px-3.5 py-2.5 text-body-sm text-on-secondary-container">
          {message}
        </p>
      ) : null}

      {editable ? (
        <button type="submit" disabled={saving} className="btn btn-primary self-start">
          {saving ? t("submitting") : initial?.status === "REJECTED" ? t("resubmit") : t("submit")}
        </button>
      ) : null}
    </form>
  );
}
