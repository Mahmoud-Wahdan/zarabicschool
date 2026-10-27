import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import MonthNav from "../../../_components/performance/month-nav";
import EmptyState from "../../../_components/ui/empty-state";
import { requireRole } from "../../../../lib/dal";
import { formatMonthLabel } from "../../../../lib/reports/month-key";
import { getAcademyIndicators, parseMonthParam } from "../../../../lib/performance/teacher-indicators";

export async function generateMetadata() {
  const t = await getTranslations("performance");
  return { title: `${t("adminTitle")} | Zarabicschool` };
}

/** S-11 / D7: the Admin's per-teacher indicator table for a month (no combined score). */
export default async function AdminPerformancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireRole("ADMIN");
  const locale = await getLocale();
  const t = await getTranslations("performance");
  const timeZone = user.timezone || "Africa/Cairo";
  const month = parseMonthParam((await searchParams).month, new Date(), timeZone);
  const rows = await getAcademyIndicators(user.academyId, month, timeZone);
  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <h1 className="text-headline-md font-bold text-primary">{t("adminTitle")}</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">{t("adminSubtitle")}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-title-md font-bold text-primary">{formatMonthLabel(month, locale === "en" ? "en" : "ar")}</p>
        <MonthNav month={month} basePath="/admin/performance" labels={{ previous: t("previousMonth"), next: t("nextMonth"), nav: t("monthNav") }} />
      </div>
      <p className="mt-2 text-label-sm text-on-surface-variant">{t("rules")}</p>
      {rows.length === 0 ? (
        <EmptyState icon="insights" title={t("empty")} />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-start text-sm">
            <thead className="border-b border-outline-variant text-label-sm text-on-surface-variant">
              <tr>
                <th className="px-3 py-2 text-start">{t("colTeacher")}</th>
                <th className="px-3 py-2 text-start">{t("sessionsHeld")}</th>
                <th className="px-3 py-2 text-start">{t("lateStarts")}</th>
                <th className="px-3 py-2 text-start">{t("noClickCount")}</th>
                <th className="px-3 py-2 text-start">{t("reportsOnTime")}</th>
                <th className="px-3 py-2 text-start">{t("reportsLate")}</th>
                <th className="px-3 py-2 text-start">{t("reportsMissing")}</th>
                <th className="px-3 py-2 text-start">{t("monthlyReports")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((row) => (
                <tr key={row.teacherId} className="border-b border-outline-variant last:border-0">
                  <td className="px-3 py-2 font-semibold">{row.displayName}</td>
                  <td className="px-3 py-2">{row.sessionsHeld}</td>
                  <td className="px-3 py-2">{row.lateStarts}</td>
                  <td className="px-3 py-2">{row.noClick}</td>
                  <td className="px-3 py-2">{row.reportsOnTime} / {row.reportsExpected}</td>
                  <td className="px-3 py-2">{row.reportsLate}</td>
                  <td className="px-3 py-2">{row.reportsMissing}</td>
                  <td className="px-3 py-2">{row.monthlyReportsSubmitted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
