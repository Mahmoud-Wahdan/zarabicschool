import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import Icon from "../../_components/ui/icon";
import MetricTile from "../../_components/ui/metric-tile";
import PageHeader from "../../_components/ui/page-header";
import EmptyState from "../../_components/ui/empty-state";
import StatusBadge, { type BadgeTone } from "../../_components/ui/status-badge";
import { Link } from "../../../i18n/navigation";
import { requireRole } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";

export const metadata = { title: "لوحة الإدارة | Zarabicschool" };

const SESSION_STATUS_TONE: Record<string, BadgeTone> = {
  SCHEDULED: "info",
  COMPLETED: "success",
  MISSED: "danger",
  CANCELLED: "neutral",
};

export default async function AdminDashboard() {
  const user = await requireRole("ADMIN");
  const locale = await getLocale();
  const t = await getTranslations("adminDash");
  const tDash = await getTranslations("dashboard");

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const [applications, students, guardians, teachers, subjects, pendingReports, redMarks, todaysSessions] =
    await Promise.all([
      prisma.application.count({ where: { academyId: user.academyId, status: { in: ["NEW", "REVIEWED"] } } }),
      prisma.student.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
      prisma.guardian.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
      prisma.teacher.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
      prisma.subject.count({ where: { academyId: user.academyId, isActive: true } }),
      prisma.report.count({ where: { academyId: user.academyId, status: "SUBMITTED" } }),
      prisma.teacherFlag.count({ where: { academyId: user.academyId, flagType: "LATE_REPORT" } }),
      prisma.session.findMany({
        where: {
          academyId: user.academyId,
          scheduledStart: { gte: startOfDay, lt: endOfDay },
        },
        orderBy: { scheduledStart: "asc" },
        take: 8,
        include: {
          subject: { select: { nameAr: true, nameEn: true } },
          teacher: { select: { user: { select: { displayName: true } } } },
          students: { include: { student: { select: { user: { select: { displayName: true } } } } } },
        },
      }),
    ]);

  const completedToday = todaysSessions.filter((session) => session.status === "COMPLETED").length;
  const upcomingToday = todaysSessions.filter((session) => session.status === "SCHEDULED").length;
  const totalToday = todaysSessions.length;
  const donePercent = totalToday ? Math.round((completedToday / totalToday) * 100) : 0;
  const upcomingPercent = totalToday ? Math.round((upcomingToday / totalToday) * 100) : 0;

  const timeFormatter = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    hour: "numeric",
    minute: "2-digit",
  });

  const opsLinks = [
    { href: "/admin/students", icon: "school", title: tDash("admin.sections.accounts"), text: `${students} ${tDash("admin.metrics.students")} · ${guardians} ${tDash("admin.metrics.guardians")} · ${teachers} ${tDash("admin.metrics.teachers")}` },
    { href: "/admin/subjects", icon: "menu_book", title: tDash("admin.sections.schedules"), text: `${subjects} ${tDash("admin.metrics.subjects")}` },
    { href: "/admin/assignments", icon: "hub", title: t("opsAssignments"), text: t("opsAssignmentsText") },
    { href: "/admin/enrollments", icon: "how_to_reg", title: t("opsEnrollments"), text: t("opsEnrollmentsText") },
    { href: "/admin/financials", icon: "receipt_long", title: t("opsFinancials"), text: t("opsFinancialsText") },
    { href: "/admin/users", icon: "manage_accounts", title: t("opsAccounts"), text: t("opsAccountsText") },
  ];

  return (
    <DashboardShell
      role={user.role}
      userName={user.displayName}
      timezone={user.timezone}
      navBadges={{ applications, reports: pendingReports }}
    >
      <PageHeader
        eyebrow={t("eyebrow")}
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label={t("kpiTodaySessions")}
          icon="video_camera_front"
          value={totalToday}
          valueLabel={t("kpiTodaySessionsUnit")}
        >
          <div className="space-y-1.5 pt-1">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-container" aria-hidden="true">
              <div className="bg-primary h-full" style={{ width: `${donePercent}%` }} />
              <div className="h-full bg-secondary" style={{ width: `${upcomingPercent}%` }} />
              <div className="h-full bg-surface-tint" style={{ width: `${100 - donePercent - upcomingPercent}%` }} />
            </div>
            <div className="flex items-center justify-between text-label-sm text-on-surface-variant">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                {completedToday} {t("done")}
              </span>
              <span className="flex items-center gap-1 font-semibold text-secondary">
                <span className="h-1.5 w-1.5 rounded-full bg-secondary" aria-hidden="true" />
                {upcomingToday} {t("upcoming")}
              </span>
            </div>
          </div>
        </MetricTile>
        <MetricTile
          label={t("kpiAdmissions")}
          icon="person_pin"
          iconTone="tertiary"
          value={applications}
          valueLabel={t("kpiAdmissionsUnit")}
          badge={{ tone: applications > 0 ? "pending" : "neutral", text: t("kpiAdmissionsNote") }}
        />
        <MetricTile
          label={t("kpiPendingReports")}
          icon="fact_check"
          iconTone="info"
          value={pendingReports}
          valueLabel={t("kpiPendingReportsUnit")}
          badge={{ tone: pendingReports > 0 ? "honor" : "neutral", text: t("kpiPendingReportsNote") }}
        />
        <MetricTile
          label={t("kpiRedMarks")}
          icon="flag"
          iconTone="tertiary"
          value={redMarks}
          valueLabel={t("kpiRedMarksUnit")}
          badge={{ tone: redMarks > 0 ? "danger" : "neutral", text: t("kpiRedMarksNote") }}
        />
      </div>

      <section className="z-card flex flex-col gap-4 rounded-xl p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-headline-sm font-bold text-primary">{t("dispatchTitle")}</h2>
            <p className="text-body-sm text-on-surface-variant">{t("dispatchSubtitle")}</p>
          </div>
          <Link href="/admin/sessions" className="btn btn-soft">
            <Icon name="calendar_month" size={18} />
            <span>{t("dispatchViewAll")}</span>
          </Link>
        </div>
        {todaysSessions.length === 0 ? (
          <EmptyState icon="video_camera_front" title={t("dispatchEmpty")} description={t("dispatchEmptyText")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="z-table min-w-[680px]">
              <thead>
                <tr>
                  <th scope="col">{t("colTime")}</th>
                  <th scope="col">{t("colSubject")}</th>
                  <th scope="col">{t("colTeacher")}</th>
                  <th scope="col">{t("colStudents")}</th>
                  <th scope="col">{t("colType")}</th>
                  <th scope="col">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {todaysSessions.map((session) => (
                  <tr key={session.id}>
                    <td className="font-mono font-semibold">
                      {timeFormatter.format(session.scheduledStart)}–{timeFormatter.format(session.scheduledEnd)}
                    </td>
                    <td className="font-semibold">
                      {locale === "en" ? session.subject.nameEn : session.subject.nameAr}
                    </td>
                    <td>{session.teacher.user.displayName}</td>
                    <td className="max-w-56 truncate">
                      {session.students.map((item) => item.student.user.displayName).join("، ") || "—"}
                    </td>
                    <td>{session.sessionType === "PRIVATE" ? t("private") : t("group")}</td>
                    <td>
                      <StatusBadge tone={SESSION_STATUS_TONE[session.status] ?? "neutral"}>
                        {t(`status.${session.status}`)}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {opsLinks.map((link) => (
          <Link key={link.href} href={link.href} className="z-card lift-card flex items-start gap-3 rounded-xl p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-low text-primary">
              <Icon name={link.icon} />
            </span>
            <span className="flex flex-col">
              <span className="text-title-md font-bold text-primary">{link.title}</span>
              <span className="text-body-sm text-on-surface-variant">{link.text}</span>
            </span>
          </Link>
        ))}
      </section>
    </DashboardShell>
  );
}
