import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import MonthNav from "../../../_components/performance/month-nav";
import EmptyState from "../../../_components/ui/empty-state";
import { requireRole } from "../../../../lib/dal";
import { formatMonthLabel } from "../../../../lib/reports/month-key";
import { getTeacherIndicators, parseMonthParam } from "../../../../lib/performance/teacher-indicators";
import { prisma } from "../../../../lib/prisma";
import { formatDateTime } from "../../../../lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("performance");
  return { title: `${t("teacherTitle")} | Zarabicschool` };
}

/**
 * S-11 / D7: the signed-in teacher's OWN indicators for a month, with the underlying
 * data (start, first platform click, first report submission). Labelled
 * "indicator"; no other teacher, no combined score.
 */
export default async function TeacherIndicatorsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireRole("TEACHER");
  const locale = await getLocale();
  const t = await getTranslations("performance");
  const timeZone = user.timezone || "Africa/Cairo";
  const month = parseMonthParam((await searchParams).month, new Date(), timeZone);
  const teacher = await prisma.teacher.findUnique({ where: { userId: user.id }, select: { id: true } });
  const data = teacher ? await getTeacherIndicators(user.academyId, teacher.id, month, timeZone) : null;
  const time = (value: Date | null) => (value ? formatDateTime(value, timeZone, locale, { hour: "2-digit", minute: "2-digit" }) : t("noClick"));
  const tiles: [string, string | number][] = data
    ? [
        [t("sessionsHeld"), data.sessionsHeld],
        [t("lateStarts"), data.lateStarts],
        [t("noClickCount"), data.noClick],
        [t("reportsOnTime"), `${data.reportsOnTime} / ${data.reportsExpected}`],
        [t("reportsLate"), data.reportsLate],
        [t("reportsMissing"), data.reportsMissing],
        [t("monthlyReports"), data.monthlyReportsSubmitted],
      ]
    : [];
  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <h1 className="text-headline-md font-bold text-primary">{t("teacherTitle")}</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">{t("teacherSubtitle")}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-title-md font-bold text-primary">{formatMonthLabel(month, locale === "en" ? "en" : "ar")}</p>
        <MonthNav month={month} basePath="/teacher/indicators" labels={{ previous: t("previousMonth"), next: t("nextMonth"), nav: t("monthNav") }} />
      </div>
      <p className="mt-2 text-label-sm text-on-surface-variant">{t("rules")}</p>
      <p className="mt-1 text-label-sm text-on-surface-variant">{t("countedAfterEnd")}</p>
      {!data || data.sessionsHeld === 0 ? (
        <EmptyState icon="insights" title={t("empty")} />
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            {tiles.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
                <dt className="text-label-sm text-on-surface-variant">{label} · {t("indicator")}</dt>
                <dd className="text-title-md font-bold tabular-nums text-primary">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] text-start text-sm">
              <caption className="mb-2 text-start text-label-md font-bold text-primary">{t("detailsTitle")}</caption>
              <thead className="border-b border-outline-variant text-label-sm text-on-surface-variant">
                <tr>
                  <th className="px-3 py-2 text-start">{t("colStart")}</th>
                  <th className="px-3 py-2 text-start">{t("colFirstClick")}</th>
                  <th className="px-3 py-2 text-start">{t("colReports")}</th>
                </tr>
              </thead>
              <tbody>
                {data.details.map((detail) => (
                  <tr key={detail.id} className="border-b border-outline-variant last:border-0">
                    <td className="px-3 py-2">{formatDateTime(detail.scheduledStart, timeZone, locale)}</td>
                    <td className={`px-3 py-2 ${detail.lateStart ? "font-semibold text-error" : ""}`}>
                      {time(detail.firstClickAt)}
                      {detail.lateStart ? ` · ${t("late")}` : ""}
                    </td>
                    <td className="px-3 py-2">{t("reportsCell", { onTime: detail.reportsOnTime, late: detail.reportsLate, missing: detail.reportsMissing })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DashboardShell>
  );
}
