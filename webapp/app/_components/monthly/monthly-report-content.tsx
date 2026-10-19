import {
  ENGAGEMENT_BAND_LABELS,
  HOMEWORK_BAND_LABELS,
  MONTHLY_PROGRESS_LABELS,
  MONTHLY_REPORT_CONTENT,
  reportDir,
  rescheduledBandLabel,
  resolveReportLanguage,
} from "../../../lib/reports/report-language";

/**
 * Read-only rendering of a monthly report's CONTENT (Session 1 — CONTEXT §9):
 * shown in the language it was written (its own dir + lang), with the enum bands
 * resolved through the report-language label packs — regardless of the viewer's
 * UI locale. The surrounding chrome stays in the UI locale.
 */
export type MonthlyReportContentData = {
  monthKey: string;
  achievement: string | null;
  learningProgress: string | null;
  classFocus: string | null;
  homeworkCompletion: string | null;
  punctuality: string | null;
  rescheduledSessions: number;
  supportAreas: string | null;
  nextMonthObjectives: string | null;
  language: string;
};

export default function MonthlyReportContent({ report }: { report: MonthlyReportContentData }) {
  const language = resolveReportLanguage(report.language);
  const content = MONTHLY_REPORT_CONTENT[language];
  const progress = report.learningProgress ? MONTHLY_PROGRESS_LABELS[language][report.learningProgress as keyof (typeof MONTHLY_PROGRESS_LABELS)[typeof language]] : null;
  const focus = report.classFocus ? ENGAGEMENT_BAND_LABELS[language][report.classFocus as keyof (typeof ENGAGEMENT_BAND_LABELS)[typeof language]] : null;
  const homework = report.homeworkCompletion ? HOMEWORK_BAND_LABELS[language][report.homeworkCompletion as keyof (typeof HOMEWORK_BAND_LABELS)[typeof language]] : null;
  const punctuality = report.punctuality ? ENGAGEMENT_BAND_LABELS[language][report.punctuality as keyof (typeof ENGAGEMENT_BAND_LABELS)[typeof language]] : null;

  const rows: { label: string; value: string }[] = [];
  if (report.achievement) rows.push({ label: content.achievementLabel, value: report.achievement });
  if (progress) rows.push({ label: content.learningProgressLabel, value: progress });
  if (focus) rows.push({ label: content.classFocusLabel, value: focus });
  if (homework) rows.push({ label: content.homeworkCompletionLabel, value: homework });
  if (punctuality) rows.push({ label: content.punctualityLabel, value: punctuality });
  // Restricted views (a student WITH a guardian sees ONLY the next-month
  // objectives — CONTEXT §9 PROPOSAL) carry a null required `achievement`, so the
  // computed band is hidden with the rest of the restricted fields.
  if (report.achievement !== null) rows.push({ label: content.rescheduledSessionsLabel, value: rescheduledBandLabel(language, report.rescheduledSessions) });
  if (report.supportAreas) rows.push({ label: content.supportAreasLabel, value: report.supportAreas });
  if (report.nextMonthObjectives) rows.push({ label: content.nextMonthObjectivesLabel, value: report.nextMonthObjectives });

  return (
    <div className="flex flex-col gap-3" dir={reportDir(language)} lang={language}>
      {rows.map((row) => (
        <div key={row.label} className="rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2">
          <p className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">{row.label}</p>
          <p className="text-body-md text-on-surface whitespace-pre-line">{row.value}</p>
        </div>
      ))}
    </div>
  );
}
