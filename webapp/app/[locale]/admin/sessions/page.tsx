import { getLocale, getTranslations } from "next-intl/server";
import DashboardShell from "../../../_components/dashboard-shell";
import MetricTile from "../../../_components/ui/metric-tile";
import PageHeader from "../../../_components/ui/page-header";
import { getTodaySessions } from "../../../../lib/dashboard/today-sessions";
import { requireRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { findLinkOverlaps } from "../../../../lib/scheduling/link-overlap";
import SessionManagementPanel from "./session-management-panel";
import JoinWindowSetting from "../../../_components/sessions/join-window-setting";
import { getJoinWindowMinutes } from "../../../../lib/sessions/join-window";

export default async function SessionsPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const locale = await getLocale();
  const t = await getTranslations("sessionsAdmin");
  const [sessions, seriesList, changeRequests, today] = await Promise.all([
    prisma.session.findMany({
      where: { academyId: user.academyId },
      orderBy: { scheduledStart: "asc" },
      take: 100,
      select: {
        id: true,
        scheduledStart: true,
        scheduledEnd: true,
        status: true,
        sessionType: true,
        timezone: true,
        zoomJoinUrl: true,
        zoomHostUrl: true,
        subject: { select: { nameEn: true, nameAr: true } },
        teacher: { select: { user: { select: { displayName: true } } } },
        students: { select: { student: { select: { user: { select: { displayName: true } } } } } },
        _count: { select: { reports: { where: { reportType: "SESSION_COMPLETION_REPORT" } } } },
      },
    }),
    prisma.recurrenceSeries.findMany({
      where: { academyId: user.academyId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        timezone: true,
        totalWeeks: true,
        generatedThroughWeek: true,
        sessionType: true,
        subject: { select: { nameEn: true, nameAr: true } },
        teacher: { select: { user: { select: { displayName: true } } } },
      },
    }),
    prisma.sessionChangeRequest.findMany({
      where: { academyId: user.academyId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        reason: true,
        proposedChange: true,
        createdAt: true,
        teacher: { select: { user: { select: { displayName: true } } } },
        session: { select: { id: true, scheduledStart: true, subject: { select: { nameEn: true, nameAr: true } } } },
      },
    }),
    // S-14: the header tiles count the whole viewer-local day (same source as the Admin home).
    getTodaySessions(user.academyId, new Date(), user.timezone || "Africa/Cairo"),
  ]);
  // Same-link overlap WARNING ids (never a block): shown in the admin list.
  const linkOverlap = findLinkOverlaps(sessions);
  // D4: the join window is a system setting — Admin only (never the Supervisor).
  const joinWindowMinutes = user.role === "ADMIN" ? await getJoinWindowMinutes(user.academyId) : null;
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <PageHeader eyebrow={t("page.kicker")} title={t("page.title")} subtitle={t("page.subtitle")} />
      {/* S-14 (Stitch "Schedule & Live Classes"): real counts only. */}
      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("metrics.label")}>
        <MetricTile label={t("metrics.today")} icon="video_camera_front" value={today.total} valueLabel={t("metrics.todayUnit", { done: today.completed, upcoming: today.upcoming })} />
        <MetricTile label={t("metrics.changeRequests")} icon="edit_calendar" iconTone="tertiary" value={changeRequests.length} valueLabel={t("metrics.waiting")} />
        <MetricTile label={t("metrics.pausedSeries")} icon="history" iconTone="tertiary" value={seriesList.filter((item) => item.status === "PAUSED").length} valueLabel={t("metrics.series")} />
        <MetricTile label={t("metrics.linkOverlaps")} icon="warning" iconTone="error" value={linkOverlap ? linkOverlap.sessionIds.length : 0} valueLabel={t("metrics.sessions")} />
      </section>
      {joinWindowMinutes !== null ? <JoinWindowSetting initialMinutes={joinWindowMinutes} /> : null}
      <SessionManagementPanel
        viewerTimezone={user.timezone}
        locale={locale}
        sessions={sessions.map(({ _count, ...session }) => ({
          ...session,
          reportCount: _count.reports,
          scheduledStart: session.scheduledStart.toISOString(),
          scheduledEnd: session.scheduledEnd.toISOString(),
        }))}
        series={seriesList}
        changeRequests={changeRequests.map((changeRequest) => ({
          ...changeRequest,
          createdAt: changeRequest.createdAt.toISOString(),
          session: { ...changeRequest.session, scheduledStart: changeRequest.session.scheduledStart.toISOString() },
        }))}
        linkOverlap={linkOverlap ? linkOverlap.sessionIds : []}
      />
    </DashboardShell>
  );
}
