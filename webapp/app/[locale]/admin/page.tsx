import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import Icon from "../../_components/ui/icon";
import PageHeader from "../../_components/ui/page-header";
import { ActionRow, TodayCard } from "../../_components/dashboard/ops-sections";
import { Link } from "../../../i18n/navigation";
import { requireRole } from "../../../lib/dal";
import { getTodaySessions } from "../../../lib/dashboard/today-sessions";
import { getAdminActionCounts, getMonthMoney } from "../../../lib/dashboard/admin-overview";
import { calendarPeriod, getCalendarRangeSessions } from "../../../lib/dashboard/calendar-range";
import { parseMonthParam, parseView } from "../../../lib/calendar/month";
import SessionsCalendar from "../../_components/calendar/sessions-calendar";
import { getTeacherFlagCounts } from "../../../lib/reports/teacher-flag-counts";
import { getEgpRevenue, parsePeriod } from "../../../lib/finance/revenue";
import { formatMoney } from "../../../lib/payments/format";
import RevenueChart from "../../_components/charts/revenue-chart";

import AnnouncementsWidget from "../../_components/announcements/announcements-widget";
export async function generateMetadata() {
  const t = await getTranslations("adminDash");
  return { title: `${t("title")} | Zarabicschool` };
}

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ revenue?: string; view?: string; week?: string; month?: string }> }) {
  const user = await requireRole("ADMIN");
  const locale = await getLocale();
  const t = await getTranslations("adminDash");

  const now = new Date();
  // "Today" = the viewer's local calendar day (Cairo time-input fix, 2026-10-27).
  const viewerZone = user.timezone || "Africa/Cairo";
  const params = await searchParams;
  const revenuePeriod = parsePeriod(params.revenue);
  const view = parseView(params.view);
  const month = parseMonthParam(params.month, now, viewerZone);
  const period = calendarPeriod(view, { week: params.week, month }, now, viewerZone);
  const [revenue, actions, money, flagCounts, today, week] = await Promise.all([
    getEgpRevenue(user.academyId, revenuePeriod, now, viewerZone),
    getAdminActionCounts(user.academyId),
    getMonthMoney(user.academyId, now, viewerZone),
    // Late SESSION-report flags; missing monthly reports counted separately (owner 2026-10-27).
    getTeacherFlagCounts(user.academyId),
    getTodaySessions(user.academyId, now, viewerZone),
    getCalendarRangeSessions({ academyId: user.academyId }, period.range),
  ]);
  const monthName = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone: viewerZone, month: "long", year: "numeric" }).format(now);
  const actionTotal = actions.reports + actions.applications + actions.sessionRequests + actions.complaints;

  return (
    <DashboardShell
      role={user.role}
      userName={user.displayName}
      timezone={user.timezone}
      navBadges={{ applications: actions.applications, reports: actions.reports }}
    >
      <AnnouncementsWidget academyId={user.academyId} timeZone={viewerZone} />
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <Link href="/admin/applications" className="btn btn-soft">
              <Icon name="person_add" size={18} className="text-secondary" />
              <span>{t("newApplication")}</span>
            </Link>
            <Link href="/admin/sessions" className="btn btn-primary">
              <Icon name="add_circle" size={18} />
              <span>{t("scheduleSession")}</span>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TodayCard sessions={today.sessions} now={now} />

        <section className="z-card flex flex-col rounded-xl p-4 sm:p-6" aria-labelledby="dash-actions">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="dash-actions" className="text-title-md font-semibold text-on-surface-variant">{t("actionsTitle")}</h2>
            <span className="text-label-md text-on-surface-variant tabular-nums">{t("actionsTotal", { count: actionTotal })}</span>
          </div>
          <ul className="mt-2 -mx-2 flex flex-col">
            <ActionRow href="/admin/reports" icon="fact_check" label={t("actionReports")} count={actions.reports} tone="honor" />
            <ActionRow href="/admin/applications" icon="person_pin" label={t("actionApplications")} count={actions.applications} tone="pending" />
            <ActionRow href="/admin/session-requests" icon="event" label={t("actionRequests")} count={actions.sessionRequests} tone="pending" />
            <ActionRow href="/admin/complaints" icon="feedback" label={t("actionComplaints")} count={actions.complaints} tone="danger" />
          </ul>
          <Link href="/admin/monthly-reports" className="mt-auto pt-3 text-label-md text-on-surface-variant underline-offset-2 hover:underline">
            {t("lateFlags", { late: flagCounts.lateReports, monthly: flagCounts.missingMonthly })}
          </Link>
        </section>

        <section className="z-card flex flex-col rounded-xl p-4 sm:p-6" aria-labelledby="dash-money">
          <h2 id="dash-money" className="text-title-md font-semibold text-on-surface-variant">{t("moneyTitle", { month: monthName })}</h2>
          {money.paid.length ? (
            <ul className="mt-2 flex flex-col gap-1">
              {money.paid.map((row) => (
                <li key={row.currency} className="flex items-baseline justify-between gap-2">
                  <span className="text-headline-md font-bold text-primary tabular-nums" dir="ltr">{formatMoney(row.amountMinor, row.currency, locale)}</span>
                  <span className="text-label-md text-on-surface-variant">{t("paidCount", { count: row.count })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-body-md text-on-surface-variant">{t("noPayments")}</p>
          )}
          <ul className="mt-4 -mx-2 flex flex-col border-t border-outline-variant pt-2">
            <ActionRow href="/admin/invoices" icon="receipt_long" label={t("unpaidInvoices")} count={money.unpaid} tone="pending" />
            <ActionRow href="/admin/renewals" icon="autorenew" label={t("pastDueRenewals")} count={money.pastDueRenewals} tone="danger" />
          </ul>
        </section>
      </div>

      <SessionsCalendar
        title={t("weekTitle")}
        subtitle={t("calendarSubtitle")}
        view={view}
        weekStart={period.weekStart}
        month={month}
        monthDays={period.grid?.days ?? null}
        sessions={week}
        now={now}
        timeZone={viewerZone}
        locale={locale}
        basePath="/admin"
        show="both"
        scheduleHref="/admin/sessions"
        scheduleLabel={t("dispatchViewAll")}
        exportName="zarabicschool-sessions"
      />

      <RevenueChart buckets={revenue} period={revenuePeriod} locale={locale} />
    </DashboardShell>
  );
}
