"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  classRemarkLabel,
  REPORT_LANGUAGE_OPTIONS,
  reportDir,
  SESSION_REPORT_CONTENT,
  type ClassRemarkOptionLike,
  type ReportLanguageCode,
} from "../../../../../../lib/reports/report-language";
import ReportAttachments, { type AttachmentItem } from "./report-attachments";

/** Client-side pre-check only — the server re-validates by content signature and size. */
const ALLOWED_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const isAllowedUpload = (file: File) => ALLOWED_UPLOAD_TYPES.includes(file.type) || file.type.startsWith("audio/");
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;
const KNOWN_ERROR_CODES = new Set([
  "SESSION_NOT_FINISHED",
  "SESSION_NOT_REPORTABLE",
  "ALREADY_SUBMITTED",
  "REPORT_IMMUTABLE",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "ATTACHMENT_TOO_LARGE",
  "INVALID_ATTACHMENT_TYPE",
  "STORAGE_NOT_CONFIGURED",
  "ATTACHMENTS_MIGRATION_PENDING",
  "STORAGE_ERROR",
  "STORAGE_MIGRATION_PENDING",
  "UPLOAD_FAILED",
]);

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
  language?: ReportLanguageCode;
};

/**
 * Per-student session report (mobile-first, RTL-first). Editing is allowed only
 * while the report is missing or REJECTED; SUBMITTED shows a waiting state and
 * APPROVED/ARCHIVED are read-only. The attendance outcome and the claimed extra
 * time are frozen from the first submission (owner decision 2026-10-14).
 *
 * Session 1 (owner, 2026-10-18 — CONTEXT §9): the teacher writes the report in
 * the STUDENT'S language (default = the student's report_language; changeable
 * per report). When a language is active, the form's labels, dropdown options,
 * placeholders and validation messages render in that language with its dir —
 * regardless of the site UI locale. `language === null` (before the Session 1
 * migration lands) keeps the previous UI-locale behavior unchanged.
 */
export default function ReportForm({
  sessionId,
  studentId,
  classRemarkOptions,
  defaultLanguage,
  initial,
  attachments,
}: {
  sessionId: string;
  studentId: string;
  classRemarkOptions: ClassRemarkOptionLike[];
  defaultLanguage?: ReportLanguageCode;
  initial: ExistingReport | null;
  attachments: AttachmentItem[];
}) {
  const t = useTranslations("teacherReport");
  const uiLocale = useLocale();
  const [currentId, setCurrentId] = useState<string | null>(initial?.id ?? null);
  const [language, setLanguage] = useState<ReportLanguageCode | null>(initial?.language ?? defaultLanguage ?? null);
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
  const [uploaded, setUploaded] = useState<AttachmentItem[]>(attachments);
  // Files picked before the FIRST submission (the report row does not exist yet);
  // they upload to the new report right after the submit succeeds.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachmentRetry, setAttachmentRetry] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Editable only while missing or REJECTED (the server enforces the same rule).
  const editable = status === null || status === "REJECTED";
  // Remark labels: the report language when active, else the UI locale (never the raw slug).
  const remarkLanguage: ReportLanguageCode = language ?? (uiLocale === "en" ? "en" : "ar");

  /** Localized message for a coded API error; falls back to the generic message. */
  function errorMessage(code: unknown): string {
    return typeof code === "string" && KNOWN_ERROR_CODES.has(code) ? t(`errors.${code}`) : t("errorGeneric");
  }

  function pickFiles(list: FileList | null) {
    setError("");
    const picked = Array.from(list ?? []);
    const rejected = picked.find((file) => !isAllowedUpload(file) || file.size > MAX_UPLOAD_BYTES);
    if (rejected) {
      setError(t(rejected.size > MAX_UPLOAD_BYTES ? "errors.ATTACHMENT_TOO_LARGE" : "errors.INVALID_ATTACHMENT_TYPE"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setPendingFiles(picked.slice(0, MAX_UPLOAD_FILES));
  }

  // Report-language content pack (null = pre-migration fallback to UI-locale labels).
  const content = language ? SESSION_REPORT_CONTENT[language] : null;
  const label = (packKey: keyof NonNullable<typeof content>, uiKey: string) =>
    content ? content[packKey] : t(uiKey);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    // Validation messages render in the report language when one is active
    // (CONTEXT §9); otherwise the UI-locale server error shape applies.
    if (form.classRemark === "") {
      setError(content ? content.requiredMessage : t("validationRequired"));
      return;
    }
    if (form.summary.trim().length < 2) {
      setError(content ? (form.summary.trim() ? content.tooShortMessage : content.requiredMessage) : t("validationTooShort"));
      return;
    }
    if (form.homework.trim().length < 1) {
      setError(content ? content.requiredMessage : t("validationRequired"));
      return;
    }
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
      body: JSON.stringify({ ...form, operationalEvents, language: language ?? undefined }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setSaving(false);
      setError(errorMessage(payload?.error?.code));
      return;
    }
    const reportId: string | null = payload?.data?.id ?? currentId;
    setStatus("SUBMITTED");
    if (reportId) setCurrentId(reportId);
    if (reportId && pendingFiles.length > 0) {
      // The report is already accepted; an attachment failure never undoes it.
      const upload = new FormData();
      pendingFiles.forEach((file) => upload.append("files", file));
      const uploadResponse = await fetch(`/api/reports/${reportId}/attachments`, { method: "POST", body: upload });
      const uploadPayload = await uploadResponse.json().catch(() => null);
      if (!uploadResponse.ok) {
        setAttachmentRetry(true);
        setError(`${t("attachmentsAfterSubmitFailed")} ${errorMessage(uploadPayload?.error?.code)}`);
      } else {
        const listResponse = await fetch(`/api/reports/${reportId}/attachments`);
        const listPayload = listResponse.ok ? await listResponse.json().catch(() => null) : null;
        if (listPayload?.data) setUploaded(listPayload.data);
      }
      setPendingFiles([]);
    }
    setSaving(false);
    setMessage(t("submittedMessage"));
  }

  return (
    <form
      onSubmit={submit}
      className="z-card mt-5 flex flex-col gap-4 rounded-xl p-4 sm:p-5"
      dir={language ? reportDir(language) : undefined}
      lang={language ?? undefined}
    >
      {status === "APPROVED" || status === "ARCHIVED" ? (
        <p className="rounded-lg bg-secondary-container px-4 py-3 text-body-md text-on-secondary-container">{t("approvedReadOnly")}</p>
      ) : null}
      {status === "SUBMITTED" ? (
        <p className="rounded-lg bg-surface-container-high px-4 py-3 text-body-md text-on-surface-variant">{t("awaitingReview")}</p>
      ) : null}
      {status === "REJECTED" && initial?.status === "REJECTED" ? (
        <div className="flex flex-col gap-1 rounded-lg bg-error-container px-4 py-3 text-on-error-container">
          <p className="text-body-md font-bold">{t("rejectedBanner")}</p>
          <p className="text-body-sm">{initial.rejectionReason}</p>
          <p className="text-label-sm opacity-80">{t("rejectedHint")}</p>
        </div>
      ) : null}

      {language ? (
        <label className="flex flex-col gap-1 text-body-sm">
          <span className="font-semibold text-on-surface">{label("languageLabel", "languageLabel")}</span>
          <select
            value={language}
            disabled={!editable}
            onChange={(event) => setLanguage(event.target.value as ReportLanguageCode)}
            className="z-input w-full"
          >
            {REPORT_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.nativeName}
              </option>
            ))}
          </select>
          <span className="text-label-sm text-on-surface-variant">{t("languageHint")}</span>
        </label>
      ) : null}

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">{label("attendanceLabel", "attendance")}</span>
        <select
          value={form.attendanceOutcome}
          disabled={!editable}
          onChange={(event) => setForm({ ...form, attendanceOutcome: event.target.value as ExistingReport["attendanceOutcome"] })}
          className="z-input w-full"
        >
          <option value="ATTENDED">{content ? content.attendanceAttended : t("attended")}</option>
          <option value="STUDENT_ABSENT">{content ? content.attendanceAbsent : t("absent")}</option>
        </select>
        <span className="text-label-sm text-on-surface-variant">{content ? content.frozenHint : t("frozenHint")}</span>
      </label>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">{label("classRemarkLabel", "classRemark")}</span>
        <select
          value={form.classRemark}
          disabled={!editable}
          aria-required="true"
          onChange={(event) => setForm({ ...form, classRemark: event.target.value })}
          className="z-input w-full"
        >
          <option value="" disabled>
            — {content ? content.classRemarkLabel : t("classRemark")} —
          </option>
          {classRemarkOptions.map((option) => (
            <option key={option.slug} value={option.slug}>
              {classRemarkLabel(classRemarkOptions, option.slug, remarkLanguage)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">{label("summaryLabel", "summary")}</span>
        <textarea
          aria-required="true"
          maxLength={5000}
          disabled={!editable}
          value={form.summary}
          onChange={(event) => setForm({ ...form, summary: event.target.value })}
          placeholder={content ? content.summaryPlaceholder : undefined}
          className="z-textarea min-h-28 w-full"
        />
      </label>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">{label("homeworkLabel", "homework")}</span>
        <textarea
          aria-required="true"
          maxLength={5000}
          disabled={!editable}
          value={form.homework}
          onChange={(event) => setForm({ ...form, homework: event.target.value })}
          placeholder={content ? content.homeworkPlaceholder : undefined}
          className="z-textarea min-h-24 w-full"
        />
        <span className="text-label-sm text-on-surface-variant">{content ? content.homeworkHint : t("homeworkHint")}</span>
      </label>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">
          {label("notesLabel", "notes")}{" "}
          <span className="font-normal text-on-surface-variant">({content ? content.optionalLabel : t("optional")})</span>
        </span>
        <textarea
          maxLength={5000}
          disabled={!editable}
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          placeholder={content ? content.notesPlaceholder : undefined}
          className="z-textarea min-h-20 w-full"
        />
      </label>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">{label("extraTimeLabel", "extraTime")}</span>
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
          {label("operationalEventsLabel", "operationalEvents")}{" "}
          <span className="font-normal text-on-surface-variant">({content ? content.optionalLabel : t("optional")})</span>
        </span>
        <textarea
          disabled={!editable}
          value={form.operationalEvents}
          onChange={(event) => setForm({ ...form, operationalEvents: event.target.value })}
          placeholder={content ? content.operationalEventsPlaceholder : '{"late_entry_minutes": 5}'}
          className="z-textarea min-h-20 w-full font-mono text-xs"
        />
        <span className="text-label-sm text-on-surface-variant">
          {content ? content.operationalEventsHint : t("operationalEventsHint")}
        </span>
      </label>

      {currentId ? (
        <ReportAttachments
          key={`${currentId}:${uploaded.length}`}
          reportId={currentId}
          initial={uploaded}
          editable={editable || attachmentRetry}
          title={content ? content.attachmentsLabel : undefined}
        />
      ) : (
        <label className="flex flex-col gap-1 text-body-sm">
          <span className="font-semibold text-on-surface">
            {content ? content.attachmentsLabel : t("attachments.title")}{" "}
            <span className="font-normal text-on-surface-variant">({content ? content.optionalLabel : t("optional")})</span>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={[...ALLOWED_UPLOAD_TYPES, "audio/*"].join(",")}
            disabled={saving}
            onChange={(event) => pickFiles(event.target.files)}
            className="w-full rounded-lg border border-outline-variant px-3 py-2 text-body-sm"
          />
          <span className="text-label-sm text-on-surface-variant">{t("attachments.uploadHint")}</span>
          {pendingFiles.length > 0 ? (
            <span className="text-label-sm text-on-surface-variant">{t("pendingFiles", { count: pendingFiles.length })}</span>
          ) : null}
        </label>
      )}

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
          {saving
            ? content
              ? content.submittingLabel
              : t("submitting")
            : initial?.status === "REJECTED"
              ? content
                ? content.resubmitLabel
                : t("resubmit")
              : content
                ? content.submitLabel
                : t("submit")}
        </button>
      ) : null}
    </form>
  );
}
