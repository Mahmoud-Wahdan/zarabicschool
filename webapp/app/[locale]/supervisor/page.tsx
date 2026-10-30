import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import EmptyState from "../../_components/ui/empty-state";
import PageHeader from "../../_components/ui/page-header";
import { ActionRow, TodayCard, WeekSessionsSection } from "../../_components/dashboard/ops-sections";
import { Link } from "../../../i18n/navigation";
import { requireRole } from "../../../lib/dal";
import { getTodaySessions } from "../../../lib/dashboard/today-sessions";
import { getAdminActionCounts, getTeacherAlerts, getWeekSessions } from "../../../lib/dashboard/admin-overview";
import { getTeacherFlagCounts } from "../../../lib/reports/teacher-flag-counts";

import AnnouncementsWidget from "../../_components/announcements/announcements-widget";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "supervisor" });
  return { title: `${t("title")} | Zarabicschool` };
}

/**
 * Supervisor home (owner, 2026-10-31): the Admin's operations dashboard without any
 * money (CONTEXT §4), with teacher alerts in place of the money card. Applications are
 * Admin-only pages, so they are not listed here.
 */
export default async function SupervisorDashboard() {
  const user = await requireRole("SUPERVISOR");
  const locale = await getLocale();
  const t = await getTranslations("supervisorDash");
  const tAdmin = await getTranslations("adminDash");

  const now = new Date();
  const viewerZone = user.timezone || "Africa/Cairo";
  const [actions, flagCounts, alerts, today, week] = await Promise.all([
    getAdminActionCounts(user.academyId),
    getTeacherFlagCounts(user.academyId),
    getTeacherAlerts(user.academyId),
    getTodaySessions(user.academyId, now, viewerZone),
    getWeekSessions(user.academyId, now, viewerZone),
  ]);
  const actionTotal = actions.reports + actions.sessionRequests + actions.complaints;

  return (
    <DashboardShell
      role={user.role}
      userName={user.displayName}
      timezone={user.timezone}
      navBadges={{ reports: actions.reports, requests: actions.sessionRequests }}
    >
      <AnnouncementsWidget academyId={user.academyId} timeZone={viewerZone} />
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TodayCard sessions={today.sessions} now={now} />

        <section className="z-card flex flex-col rounded-xl p-4 sm:p-6" aria-labelledby="dash-actions">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="dash-actions" className="text-title-md font-semibold text-on-surface-variant">{tAdmin("actionsTitle")}</h2>
            <span className="text-label-md text-on-surface-variant tabular-nums">{tAdmin("actionsTotal", { count: actionTotal })}</span>
          </div>
          <ul className="mt-2 -mx-2 flex flex-col">
            <ActionRow href="/supervisor/reports" icon="fact_check" label={tAdmin("actionReports")} count={actions.reports} tone="honor" />
            <ActionRow href="/supervisor/session-requests" icon="event" label={tAdmin("actionRequests")} count={actions.sessionRequests} tone="pending" />
            <ActionRow href="/admin/complaints" icon="feedback" label={tAdmin("actionComplaints")} count={actions.complaints} tone="danger" />
          </ul>
        </section>

        <section className="z-card flex flex-col rounded-xl p-4 sm:p-6" aria-labelledby="dash-alerts">
          <h2 id="dash-alerts" className="text-title-md font-semibold text-on-surface-variant">{t("alertsTitle")}</h2>
          {alerts.length ? (
            <ul className="mt-2 flex flex-col divide-y divide-outline-variant">
              {alerts.map((alert) => (
                <li key={alert.teacherId} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="truncate text-body-md text-on-surface">{alert.name}</span>
                  <span className="flex shrink-0 gap-1.5">
                    {alert.late ? <Link href="/supervisor/reports" className="badge badge--danger">{t("alertLate", { count: alert.late })}</Link> : null}
                    {alert.monthly ? <Link href="/supervisor/monthly-reports" className="badge badge--pending">{t("alertMonthly", { count: alert.monthly })}</Link> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="verified" title={t("alertsNone")} />
          )}
          <p className="mt-auto pt-3 text-label-md text-on-surface-variant">
            {tAdmin("lateFlags", { late: flagCounts.lateReports, monthly: flagCounts.missingMonthly })}
          </p>
        </section>
      </div>

      <WeekSessionsSection sessions={week} locale={locale} timeZone={viewerZone} exportName="zarabicschool-week-sessions" />
    </DashboardShell>
  );
}
