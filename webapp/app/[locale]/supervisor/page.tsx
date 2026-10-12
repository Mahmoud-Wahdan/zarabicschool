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

const SESSION_STATUS_TONE: Record<string, BadgeTone> = {
  SCHEDULED: "info",
  COMPLETED: "success",
  MISSED: "danger",
  CANCELLED: "neutral",
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "supervisor" });
  return { title: `${t("title")} | Zarabicschool` };
}

export default async function SupervisorDashboard() {
  const user = await requireRole("SUPERVISOR");
  const locale = await getLocale();
  const t = await getTranslations("supervisorDash");
  const tSupervisor = await getTranslations("supervisor");

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const [profileCounts, pendingReports, redMarks, todaysSessions] = await Promise.all([
    Promise.all([
      prisma.student.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
      prisma.guardian.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
      prisma.teacher.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
      prisma.subject.count({ where: { academyId: user.academyId, isActive: true } }),
    ]),
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
  const [students, guardians, teachers, subjects] = profileCounts;

  const completedToday = todaysSessions.filter((session) => session.status === "COMPLETED").length;
  const upcomingToday = todaysSessions.filter((session) => session.status === "SCHEDULED").length;
  const totalToday = todaysSessions.length;
  const donePercent = totalToday ? Math.round((completedToday / totalToday) * 100) : 0;
  const upcomingPercent = totalToday ? Math.round((upcomingToday / totalToday) * 100) : 0;

  const timeFormatter = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <DashboardShell
      role={user.role}
      userName={user.displayName}
      timezone={user.timezone}
      navBadges={{ reports: pendingReports }}
    >
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />

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
        <MetricTile
          label={tSupervisor("profiles.teachers")}
          icon="co_present"
          iconTone="secondary"
          value={teachers}
          valueLabel={`${students} ${tSupervisor("profiles.students")} · ${guardians} ${tSupervisor("profiles.guardians")}`}
        />
      </div>

      <section className="z-card flex flex-col gap-4 rounded-xl p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-headline-sm font-bold text-primary">{t("dispatchTitle")}</h2>
            <p className="text-body-sm text-on-surface-variant">{t("dispatchSubtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/supervisor/reports" className="btn btn-primary">
              <Icon name="fact_check" size={18} />
              <span>{tSupervisor("operations.reports")}</span>
            </Link>
            <Link href="/admin/sessions" className="btn btn-soft">
              <Icon name="calendar_month" size={18} />
              <span>{t("dispatchViewAll")}</span>
            </Link>
          </div>
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
        {[
          { href: "/admin/students", icon: "school", title: tSupervisor("actions.students"), text: tSupervisor("actions.studentsDescription") },
          { href: "/admin/teachers", icon: "co_present", title: tSupervisor("actions.teachers"), text: tSupervisor("actions.teachersDescription") },
          { href: "/admin/subjects", icon: "menu_book", title: tSupervisor("actions.subjects"), text: `${subjects} ${tSupervisor("profiles.subjects")}` },
          { href: "/admin/assignments", icon: "hub", title: tSupervisor("actions.assignments"), text: tSupervisor("actions.assignmentsDescription") },
          { href: "/admin/enrollments", icon: "how_to_reg", title: tSupervisor("actions.enrollments"), text: tSupervisor("actions.enrollmentsDescription") },
        ].map((link) => (
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

      <p className="rounded-xl border border-outline-variant bg-surface-container-low p-4 text-body-sm text-on-surface-variant">
        {tSupervisor("restricted")}
      </p>
    </DashboardShell>
  );
}
