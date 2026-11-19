import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "../../../i18n/navigation";
import type { AuthUser } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { getMonthlyReportByIdForViewer } from "../../../lib/reports/monthly";
import { formatMonthLabel } from "../../../lib/reports/month-key";
import { isSession1ReportsReady } from "../../../lib/reports/session1-ready";
import { MONTHLY_REPORT_CONTENT, reportDir } from "../../../lib/reports/report-language";
import { monthRangeUtc } from "../../../lib/performance/teacher-indicators";

/** The visibility service shapes each field, including objectives-only student reports. */
export default async function LearningReview({ user, studentId, month }: { user: AuthUser; studentId?: string; month: string }) {
  if (user.role !== "STUDENT" && user.role !== "GUARDIAN") return null;
  if (!studentId || !await isSession1ReportsReady()) return null;
  const learner = user.role === "STUDENT" ? { userId: user.id } : { guardian: { userId: user.id } };
  const { start, end } = monthRangeUtc(month, user.timezone || "Africa/Cairo");
  const completedSessions = { academyId: user.academyId, status: "COMPLETED" as const,
    scheduledStart: { gte: start, lt: end }, students: { some: { studentId, student: learner } } };
  const [latest, t, locale, subjects] = await Promise.all([
    prisma.monthlyReport.findFirst({
      where: { academyId: user.academyId, studentId, student: learner, monthKey: { lte: month } },
      orderBy: [{ monthKey: "desc" }, { submittedAt: "desc" }, { id: "desc" }], select: { id: true },
    }),
    getTranslations("activity"), getLocale(),
    prisma.subject.findMany({ where: { academyId: user.academyId, sessions: { some: completedSessions } },
      select: { id: true, nameAr: true, nameEn: true, _count: { select: { sessions: { where: completedSessions } } } },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  const report = latest && await getMonthlyReportByIdForViewer({ ...user, userId: user.id }, latest.id);
  return <section className="mt-4 border-t border-outline-variant pt-4">
    <h3 className="text-title-md font-semibold">{t("learningReview")}</h3>
    {report ? <>
      <p className="text-body-sm text-on-surface-variant">{formatMonthLabel(report.monthKey, locale === "ar" ? "ar" : "en")}</p>
      <dl lang={report.language} dir={reportDir(report.language)} className="mt-2 space-y-2 text-body-sm">
        {report.achievement && <div><dt className="font-semibold">{MONTHLY_REPORT_CONTENT[report.language].achievementLabel}</dt><dd>{report.achievement}</dd></div>}
        {report.nextMonthObjectives && <div><dt className="font-semibold">{MONTHLY_REPORT_CONTENT[report.language].nextMonthObjectivesLabel}</dt><dd>{report.nextMonthObjectives}</dd></div>}
      </dl>
    </> : <p className="text-body-sm text-on-surface-variant">{t("noMonthly")}</p>}
    <Link href={user.role === "GUARDIAN" ? "/guardian/monthly-reports" : "/student/monthly-reports"} className="mt-2 inline-block text-body-sm text-secondary underline">{t("monthlyHistory")}</Link>
    {subjects.length > 0 && <details className="mt-3 text-body-sm">
      <summary className="cursor-pointer py-2 font-semibold">{t("subjectsCompleted", { month: formatMonthLabel(month, locale === "ar" ? "ar" : "en") })}</summary>
      <dl>{subjects.map(subject => <div key={subject.id} className="flex justify-between gap-2 border-t border-outline-variant py-2">
        <dt>{locale === "ar" ? subject.nameAr : subject.nameEn}</dt><dd>{new Intl.NumberFormat(locale).format(subject._count.sessions)}</dd>
      </div>)}</dl>
    </details>}
  </section>;
}
