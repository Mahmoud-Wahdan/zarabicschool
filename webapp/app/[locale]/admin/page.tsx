import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import Icon, { type IconName } from "../../_components/ui/icon";
import PageHeader from "../../_components/ui/page-header";
import DataTable, { type DataRow } from "../../_components/ui/data-table";
import { type BadgeTone } from "../../_components/ui/status-badge";
import { Link } from "../../../i18n/navigation";
import { requireRole } from "../../../lib/dal";
import { getTodaySessions } from "../../../lib/dashboard/today-sessions";
import { getAdminActionCounts, getMonthMoney, getWeekSessions } from "../../../lib/dashboard/admin-overview";
import { getTeacherFlagCounts } from "../../../lib/reports/teacher-flag-counts";
import { getEgpRevenue, parsePeriod } from "../../../lib/finance/revenue";
import { formatMoney } from "../../../lib/payments/format";
import RevenueChart from "../../_components/charts/revenue-chart";

import AnnouncementsWidget from "../../_components/announcements/announcements-widget";
export async function generateMetadata() {
  const t = await getTranslations("adminDash");
  return { title: `${t("title")} | Zarabicschool` };
}

const SESSION_STATUS_TONE: Record<string, BadgeTone> = {
  SCHEDULED: "info",
  COMPLETED: "success",
  MISSED: "danger",
  CANCELLED: "neutral",
};

/** One row of "needs you": a count that links to where it is handled. */
function ActionRow({ href, icon, label, count, tone }: { href: string; icon: IconName; label: string; count: number; tone: BadgeTone }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-container-low">
        <span className="flex items-center gap-2.5 text-body-md text-on-surface">
          <Icon name={icon} size={20} className="text-on-surface-variant" />
          {label}
        </span>
        <span className={`badge ${count > 0 ? `badge--${tone}` : "badge--neutral"} tabular-nums`}>{count}</span>
      </Link>
    </li>
  );
}

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ revenue?: string }> }) {
  const user = await requireRole("ADMIN");
  const locale = await getLocale();
  const t = await getTranslations("adminDash");

  const now = new Date();
  // "Today" = the viewer's local calendar day (Cairo time-input fix, 2026-10-27).
  const viewerZone = user.timezone || "Africa/Cairo";
  const revenuePeriod = parsePeriod((await searchParams).revenue);
  const [revenue, actions, money, flagCounts, today, week] = await Promise.all([
    getEgpRevenue(user.academyId, revenuePeriod, now, viewerZone),
    getAdminActionCounts(user.academyId),
    getMonthMoney(user.academyId, now, viewerZone),
    // Late SESSION-report flags; missing monthly reports counted separately (owner 2026-10-27).
    getTeacherFlagCounts(user.academyId),
    getTodaySessions(user.academyId, now, viewerZone),
    getWeekSessions(user.academyId, now, viewerZone),
  ]);
  const liveNow = today.sessions.filter((session) => session.status === "SCHEDULED" && session.scheduledStart <= now && session.scheduledEnd > now).length;
  const upcomingToday = today.sessions.filter((session) => session.status === "SCHEDULED" && session.scheduledStart > now).length;

  const dateLocale = locale === "ar" ? "ar-EG" : "en-GB";
  const dayFormat = new Intl.DateTimeFormat(dateLocale, { timeZone: viewerZone, weekday: "short", day: "numeric", month: "short" });
  const timeFormat = new Intl.DateTimeFormat(dateLocale, { timeZone: viewerZone, hour: "numeric", minute: "2-digit" });
  const monthName = new Intl.DateTimeFormat(dateLocale, { timeZone: viewerZone, month: "long", year: "numeric" }).format(now);
  const listSeparator = locale === "ar" ? "، " : ", ";

  const weekRows: DataRow[] = week.map((session) => ({
    id: session.id,
    filter: session.status,
    cells: {
      day: { text: dayFormat.format(session.scheduledStart), sort: session.scheduledStart.toISOString(), strong: true, numeric: true },
      time: { text: `${timeFormat.format(session.scheduledStart)} – ${timeFormat.format(session.scheduledEnd)}`, sort: session.scheduledStart.toISOString(), numeric: true },
      subject: { text: locale === "en" ? session.subject.nameEn : session.subject.nameAr },
      teacher: { text: session.teacher.user.displayName },
      students: { text: session.students.map((item) => item.student.user.displayName).join(listSeparator) || "—" },
      type: { text: session.sessionType === "PRIVATE" ? t("private") : t("group") },
      status: { text: t(`status.${session.status}`), tone: SESSION_STATUS_TONE[session.status] ?? "neutral" },
    },
  }));
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
        <section className="z-card flex flex-col rounded-xl p-4 sm:p-6" aria-labelledby="dash-today">
          <h2 id="dash-today" className="text-title-md font-semibold text-on-surface-variant">{t("todayTitle")}</h2>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="text-display-hero font-bold leading-none text-primary tabular-nums">{today.total}</span>
            <span className="text-body-md text-on-surface-variant">{t("kpiTodaySessionsUnit")}</span>
          </p>
          <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-outline-variant pt-4">
            <div>
              <dt className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
                <span className={`h-2 w-2 rounded-full ${liveNow ? "bg-secondary badge-dot--pulse" : "bg-outline-variant"}`} aria-hidden="true" />
                {t("liveNow")}
              </dt>
              <dd className="text-headline-sm font-semibold text-on-surface tabular-nums">{liveNow}</dd>
            </div>
            <div>
              <dt className="text-label-sm text-on-surface-variant">{t("upcoming")}</dt>
              <dd className="text-headline-sm font-semibold text-on-surface tabular-nums">{upcomingToday}</dd>
            </div>
            <div>
              <dt className="text-label-sm text-on-surface-variant">{t("done")}</dt>
              <dd className="text-headline-sm font-semibold text-on-surface tabular-nums">{today.completed}</dd>
            </div>
          </dl>
        </section>

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

      <section className="z-card flex min-w-0 flex-col gap-1 overflow-hidden rounded-xl pt-4 sm:pt-6" aria-labelledby="dash-week">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 sm:px-6">
          <div>
            <h2 id="dash-week" className="text-headline-sm font-bold text-primary">{t("weekTitle")}</h2>
            <p className="text-body-sm text-on-surface-variant">{t("weekSubtitle")}</p>
          </div>
          <Link href="/admin/sessions" className="btn btn-soft">
            <Icon name="calendar_month" size={18} />
            <span>{t("dispatchViewAll")}</span>
          </Link>
        </div>
        <DataTable
          caption={t("weekTitle")}
          columns={[
            { key: "day", label: t("colDay") },
            { key: "time", label: t("colTime") },
            { key: "subject", label: t("colSubject") },
            { key: "teacher", label: t("colTeacher") },
            { key: "students", label: t("colStudents"), sortable: false },
            { key: "type", label: t("colType") },
            { key: "status", label: t("colStatus") },
          ]}
          rows={weekRows}
          quickFilters={["SCHEDULED", "COMPLETED", "MISSED", "CANCELLED"].map((status) => ({ key: status, label: t(`status.${status}`) }))}
          exportName="zarabicschool-week-sessions"
          emptyTitle={t("weekEmpty")}
          emptyIcon="video_camera_front"
          initialSort={{ key: "day", direction: "asc" }}
        />
      </section>

      <RevenueChart buckets={revenue} period={revenuePeriod} locale={locale} />
    </DashboardShell>
  );
}
