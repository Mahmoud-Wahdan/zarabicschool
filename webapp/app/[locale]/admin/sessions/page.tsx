import { getLocale } from "next-intl/server";
import DashboardShell from "../../../_components/dashboard-shell";
import { requireRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import SessionManagementPanel from "./session-management-panel";

export default async function SessionsPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const locale = await getLocale();
  const [sessions, seriesList, changeRequests] = await Promise.all([
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
        subject: { select: { nameEn: true, nameAr: true } },
        teacher: { select: { user: { select: { displayName: true } } } },
        students: { select: { student: { select: { user: { select: { displayName: true } } } } } },
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
  ]);
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-8 text-white sm:px-10">
        <p className="text-sm font-semibold text-[var(--gold)]">Schedules & Sessions</p>
        <h1 className="mt-2 text-3xl font-bold">Manage academy sessions</h1>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-white/80">Create private or group classes, run weekly series that respect student credit, and keep every Zoom link in one operational timeline.</p>
      </section>
      <SessionManagementPanel
        viewerTimezone={user.timezone}
        locale={locale}
        sessions={sessions.map((session) => ({ ...session, scheduledStart: session.scheduledStart.toISOString(), scheduledEnd: session.scheduledEnd.toISOString() }))}
        series={seriesList}
        changeRequests={changeRequests.map((changeRequest) => ({ ...changeRequest, createdAt: changeRequest.createdAt.toISOString(), session: { ...changeRequest.session, scheduledStart: changeRequest.session.scheduledStart.toISOString() } }))}
      />
    </DashboardShell>
  );
}
