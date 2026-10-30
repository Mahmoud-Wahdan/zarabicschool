import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import PageHeader from "../../../_components/ui/page-header";
import EmptyState from "../../../_components/ui/empty-state";
import RevenueChart from "../../../_components/charts/revenue-chart";
import { BarList, CHART_COLORS, ChartCard, LineSeries, StackedColumns } from "../../../_components/charts/analytics-charts";
import { requireRoles } from "../../../../lib/dal";
import { getAcademyAnalytics } from "../../../../lib/analytics/academy";
import { getEgpRevenue, parsePeriod } from "../../../../lib/finance/revenue";

export async function generateMetadata() {
  const t = await getTranslations("analytics");
  return { title: `${t("title")} | Zarabicschool` };
}

/**
 * Analytics (owner, 2026-10-31). Admin and Supervisor; the revenue chart is Admin only
 * (the Supervisor never sees money, CONTEXT §4). Weeks start on Saturday; every bucket
 * is in the viewer's zone.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ revenue?: string }> }) {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const [t, locale] = await Promise.all([getTranslations("analytics"), getLocale()]);
  const zone = user.timezone || "Africa/Cairo";
  const now = new Date();
  const isAdmin = user.role === "ADMIN";
  const revenuePeriod = parsePeriod((await searchParams).revenue);
  const [data, revenue] = await Promise.all([
    getAcademyAnalytics(user.academyId, now, zone),
    isAdmin ? getEgpRevenue(user.academyId, revenuePeriod, now, zone) : null,
  ]);

  const dateLocale = locale === "ar" ? "ar-EG" : "en-GB";
  const number = new Intl.NumberFormat(dateLocale, { maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(dateLocale, { style: "percent", maximumFractionDigits: 0 });
  const weekLabel = new Intl.DateTimeFormat(dateLocale, { timeZone: "UTC", day: "numeric", month: "short" });
  const monthLabel = new Intl.DateTimeFormat(dateLocale, { timeZone: "UTC", month: "short", year: "2-digit" });
  const monthTitle = new Intl.DateTimeFormat(dateLocale, { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${data.month}-15T12:00:00Z`));
  const noon = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
  const subjectName = (subject: { nameAr: string; nameEn: string }) => (locale === "ar" ? subject.nameAr : subject.nameEn);

  const weekRows = data.weeks.map((week) => ({ ...week, label: weekLabel.format(noon(week.weekStart)) }));
  const summary = [
    { label: t("summaryAttendance"), value: data.summary.attendanceRate === null ? "—" : percent.format(data.summary.attendanceRate) },
    { label: t("summaryCompleted"), value: number.format(data.summary.completed) },
    { label: t("summaryMissed"), value: number.format(data.summary.missed) },
    { label: t("summaryHours"), value: number.format(data.summary.hours) },
    { label: t("summaryNewStudents"), value: number.format(data.summary.newStudents) },
  ];

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <PageHeader title={t("title")} subtitle={t("subtitle", { zone })} />

      <section className="z-card rounded-xl p-4 sm:p-6" aria-labelledby="analytics-month">
        <h2 id="analytics-month" className="text-title-md font-semibold text-on-surface-variant">{t("summaryTitle", { month: monthTitle })}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {summary.map((item) => (
            <div key={item.label} className="border-s border-outline-variant ps-3">
              <dt className="text-label-sm text-on-surface-variant">{item.label}</dt>
              <dd className="text-headline-md font-bold text-primary tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          id="chart-sessions"
          title={t("sessionsTitle")}
          subtitle={t("sessionsSubtitle")}
          legend={[
            { label: t("completed"), color: CHART_COLORS.completed },
            { label: t("missed"), color: CHART_COLORS.missed },
            { label: t("scheduled"), color: CHART_COLORS.scheduled },
          ]}
          tableLabel={t("showTable")}
          table={{
            head: [t("colWeek"), t("completed"), t("missed"), t("scheduled"), t("cancelled")],
            rows: weekRows.map((week) => [week.label, week.completed, week.missed, week.scheduled, week.cancelled]),
          }}
        >
          <StackedColumns
            label={t("sessionsTitle")}
            series={[{ color: CHART_COLORS.completed }, { color: CHART_COLORS.missed }, { color: CHART_COLORS.scheduled }]}
            buckets={weekRows.map((week) => ({
              label: week.label,
              values: [week.completed, week.missed, week.scheduled],
              tooltip: t("sessionsTooltip", { week: week.label, completed: week.completed, missed: week.missed, scheduled: week.scheduled, cancelled: week.cancelled }),
            }))}
            format={(value) => number.format(value)}
          />
        </ChartCard>

        <ChartCard
          id="chart-attendance"
          title={t("attendanceTitle")}
          subtitle={t("attendanceSubtitle")}
          tableLabel={t("showTable")}
          table={{
            head: [t("colWeek"), t("attended"), t("reported"), t("rate")],
            rows: weekRows.map((week) => [week.label, week.attended, week.reported, week.reported ? percent.format(week.attended / week.reported) : "—"]),
          }}
        >
          <LineSeries
            label={t("attendanceTitle")}
            emptyLabel={t("noAttendance")}
            max={1}
            points={weekRows.map((week) => ({
              label: week.label,
              value: week.reported ? week.attended / week.reported : null,
              tooltip: week.reported ? t("attendanceTooltip", { week: week.label, rate: percent.format(week.attended / week.reported), attended: week.attended, reported: week.reported }) : t("noReports", { week: week.label }),
            }))}
            format={(value) => percent.format(value)}
          />
        </ChartCard>

        <ChartCard
          id="chart-hours"
          title={t("hoursTitle", { month: monthTitle })}
          subtitle={t("hoursSubtitle")}
          tableLabel={t("showTable")}
          table={{ head: [t("colTeacher"), t("colHours")], rows: data.teacherHours.map((row) => [row.name, number.format(row.hours)]) }}
        >
          {data.teacherHours.length ? (
            <BarList label={t("hoursTitle", { month: monthTitle })} items={data.teacherHours.map((row) => ({ name: row.name, value: row.hours, valueLabel: t("hoursValue", { hours: number.format(row.hours) }) }))} />
          ) : (
            <EmptyState icon="schedule" title={t("noHours")} />
          )}
        </ChartCard>

        <ChartCard
          id="chart-subjects"
          title={t("subjectsTitle", { month: monthTitle })}
          subtitle={t("subjectsSubtitle")}
          tableLabel={t("showTable")}
          table={{ head: [t("colSubject"), t("colSessions")], rows: data.subjectSessions.map((row) => [subjectName(row), row.count]) }}
        >
          {data.subjectSessions.length ? (
            <BarList label={t("subjectsTitle", { month: monthTitle })} color={CHART_COLORS.scheduled} items={data.subjectSessions.map((row) => ({ name: subjectName(row), value: row.count, valueLabel: number.format(row.count) }))} />
          ) : (
            <EmptyState icon="menu_book" title={t("noSubjects")} />
          )}
        </ChartCard>

        <ChartCard
          id="chart-students"
          className="xl:col-span-2"
          title={t("studentsTitle")}
          subtitle={t("studentsSubtitle")}
          tableLabel={t("showTable")}
          table={{ head: [t("colMonth"), t("colNewStudents")], rows: data.newStudents.map((row) => [monthLabel.format(noon(`${row.month}-15`)), row.count]) }}
        >
          <StackedColumns
            label={t("studentsTitle")}
            width={1100}
            series={[{ color: CHART_COLORS.single }]}
            buckets={data.newStudents.map((row) => ({
              label: monthLabel.format(noon(`${row.month}-15`)),
              values: [row.count],
              tooltip: t("studentsTooltip", { month: monthLabel.format(noon(`${row.month}-15`)), count: row.count }),
            }))}
            format={(value) => number.format(value)}
          />
        </ChartCard>
      </div>

      {isAdmin && revenue ? <RevenueChart buckets={revenue} period={revenuePeriod} locale={locale} /> : null}
    </DashboardShell>
  );
}
