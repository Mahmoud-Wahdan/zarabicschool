"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  ENGAGEMENT_BAND_LABELS,
  HOMEWORK_BAND_LABELS,
  MONTHLY_PROGRESS_LABELS,
  MONTHLY_REPORT_CONTENT,
  REPORT_LANGUAGE_OPTIONS,
  reportDir,
  rescheduledBandLabel,
  type ReportLanguageCode,
} from "../../../../../lib/reports/report-language";

type ProgressKey = "EXCELLENT" | "VERY_GOOD" | "GOOD" | "VERY_SLOW_PROGRESS";
type EngagementKey = "ALWAYS" | "OFTEN" | "SOMETIMES" | "RARELY";
type HomeworkKey = "ALWAYS" | "MOST_OF_THE_TIME" | "SOMETIMES" | "RARELY";

type ExistingMonthly = {
  achievement: string;
  learningProgress: ProgressKey;
  classFocus: EngagementKey;
  homeworkCompletion: HomeworkKey;
  punctuality: EngagementKey;
  supportAreas: string | null;
  nextMonthObjectives: string | null;
  language: string;
} | null;

/**
 * Monthly report form (Session 1 — CONTEXT §9): labels, dropdown options,
 * placeholders and validation messages render in the REPORT language (selector
 * default = the student's report_language); "sessions rescheduled" is computed
 * server-side and read-only. Submits to POST /api/monthly-reports.
 */
export default function MonthlyReportForm({
  studentId,
  studentName,
  monthKey,
  rescheduledSessions,
  defaultLanguage,
  initial,
}: {
  studentId: string;
  studentName: string;
  monthKey: string;
  rescheduledSessions: number;
  defaultLanguage: ReportLanguageCode;
  initial: ExistingMonthly;
}) {
  const t = useTranslations("teacherMonthly");
  const router = useRouter();
  const [language, setLanguage] = useState<ReportLanguageCode>(
    initial?.language === "ar" || initial?.language === "en" || initial?.language === "fr" || initial?.language === "de" || initial?.language === "tr"
      ? initial.language
      : defaultLanguage,
  );
  const content = MONTHLY_REPORT_CONTENT[language];
  const [form, setForm] = useState({
    achievement: initial?.achievement ?? "",
    learningProgress: initial?.learningProgress ?? "EXCELLENT",
    classFocus: initial?.classFocus ?? "ALWAYS",
    homeworkCompletion: initial?.homeworkCompletion ?? "ALWAYS",
    punctuality: initial?.punctuality ?? "ALWAYS",
    supportAreas: initial?.supportAreas ?? "",
    nextMonthObjectives: initial?.nextMonthObjectives ?? "",
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (form.achievement.trim().length < 2) {
      setError(form.achievement.trim() ? content.tooShortMessage : content.requiredMessage);
      return;
    }
    setSaving(true);
    const response = await fetch("/api/monthly-reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentId,
        monthKey,
        achievement: form.achievement,
        learningProgress: form.learningProgress,
        classFocus: form.classFocus,
        homeworkCompletion: form.homeworkCompletion,
        punctuality: form.punctuality,
        supportAreas: form.supportAreas || undefined,
        nextMonthObjectives: form.nextMonthObjectives || undefined,
        language,
      }),
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? t("errorGeneric"));
      return;
    }
    setMessage(t("submittedMessage"));
    router.refresh();
  }

  const selectClass = "z-input w-full";
  const bandOptions = <K extends string>(labels: Record<ReportLanguageCode, Record<K, string>>) =>
    (Object.keys(labels[language]) as K[]).map((key) => (
      <option key={key} value={key}>
        {labels[language][key]}
      </option>
    ));

  return (
    <form
      onSubmit={submit}
      className="z-card mt-5 flex flex-col gap-4 rounded-xl p-4 sm:p-5"
      dir={reportDir(language)}
      lang={language}
    >
      <div className="flex items-center gap-3 border-b border-outline-variant pb-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-container text-sm font-bold text-on-primary">
          {studentName.trim().slice(0, 1).toUpperCase() || "?"}
        </span>
        <div>
          <p className="text-title-md font-bold text-primary">{studentName}</p>
          <p className="text-label-sm text-on-surface-variant">{monthKey}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

        <label className="flex flex-col gap-1 text-body-sm">
          <span className="font-semibold text-on-surface">{content.monthLabel}</span>
          <input value={monthKey} readOnly disabled className={`${selectClass} opacity-70`} />
        </label>
        <label className="flex flex-col gap-1 text-body-sm">
          <span className="font-semibold text-on-surface">{content.languageLabel}</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value as ReportLanguageCode)} className={selectClass}>
            {REPORT_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.nativeName}
              </option>
            ))}
          </select>
          <span className="text-label-sm text-on-surface-variant">{t("languageHint")}</span>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">{content.achievementLabel}</span>
        <textarea
          aria-required="true"
          maxLength={10000}
          value={form.achievement}
          onChange={(event) => setForm({ ...form, achievement: event.target.value })}
          placeholder={content.achievementPlaceholder}
          className="z-textarea min-h-28 w-full"
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-body-sm">
          <span className="font-semibold text-on-surface">{content.learningProgressLabel}</span>
          <select
            value={form.learningProgress}
            onChange={(event) => setForm({ ...form, learningProgress: event.target.value as ProgressKey })}
            className={selectClass}
          >
            {bandOptions(MONTHLY_PROGRESS_LABELS)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-body-sm">
          <span className="font-semibold text-on-surface">{content.classFocusLabel}</span>
          <select
            value={form.classFocus}
            onChange={(event) => setForm({ ...form, classFocus: event.target.value as "ALWAYS" | "OFTEN" | "SOMETIMES" | "RARELY" })}
            className={selectClass}
          >
            {bandOptions(ENGAGEMENT_BAND_LABELS)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-body-sm">
          <span className="font-semibold text-on-surface">{content.homeworkCompletionLabel}</span>
          <select
            value={form.homeworkCompletion}
            onChange={(event) => setForm({ ...form, homeworkCompletion: event.target.value as "ALWAYS" | "MOST_OF_THE_TIME" | "SOMETIMES" | "RARELY" })}
            className={selectClass}
          >
            {bandOptions(HOMEWORK_BAND_LABELS)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-body-sm">
          <span className="font-semibold text-on-surface">{content.punctualityLabel}</span>
          <select
            value={form.punctuality}
            onChange={(event) => setForm({ ...form, punctuality: event.target.value as "ALWAYS" | "OFTEN" | "SOMETIMES" | "RARELY" })}
            className={selectClass}
          >
            {bandOptions(ENGAGEMENT_BAND_LABELS)}
          </select>
        </label>
      </div>

      <div className="rounded-lg bg-surface-container-low px-3 py-2">
        <p className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">{content.rescheduledSessionsLabel}</p>
        <p className="text-body-md font-semibold text-primary">{rescheduledBandLabel(language, rescheduledSessions)}</p>
        <p className="text-label-sm text-on-surface-variant">{t("rescheduledComputedHint")}</p>
      </div>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">
          {content.supportAreasLabel} <span className="font-normal text-on-surface-variant">({t("optionalChip")})</span>
        </span>
        <textarea
          maxLength={5000}
          value={form.supportAreas}
          onChange={(event) => setForm({ ...form, supportAreas: event.target.value })}
          placeholder={content.supportAreasPlaceholder}
          className="z-textarea min-h-20 w-full"
        />
      </label>

      <label className="flex flex-col gap-1 text-body-sm">
        <span className="font-semibold text-on-surface">
          {content.nextMonthObjectivesLabel} <span className="font-normal text-on-surface-variant">({t("optionalChip")})</span>
        </span>
        <textarea
          maxLength={5000}
          value={form.nextMonthObjectives}
          onChange={(event) => setForm({ ...form, nextMonthObjectives: event.target.value })}
          placeholder={content.nextMonthObjectivesPlaceholder}
          className="z-textarea min-h-20 w-full"
        />
        <span className="text-label-sm text-on-surface-variant">{t("objectivesVisibilityHint")}</span>
      </label>

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

      <button type="submit" disabled={saving} className="btn btn-primary self-start">
        {saving ? content.saveLabel : initial ? content.saveLabel : content.submitLabel}
      </button>
    </form>
  );
}
