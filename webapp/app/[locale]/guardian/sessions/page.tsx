import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import SessionJoinLink from "../../../_components/session-join-link";
import SessionRequestForm from "../../../_components/session-request-form";
import Icon from "../../../_components/ui/icon";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { joinWindowState } from "../../../../lib/config/session-join";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export default async function GuardianSessionsPage() {
  const user = await requireRole("GUARDIAN");
  const locale = await getLocale();
  const t = await getTranslations("sessions");
  const now = new Date();
  const [children, sessions] = await Promise.all([
    prisma.student.findMany({
      where: { academyId: user.academyId, guardian: { userId: user.id } },
      orderBy: { createdAt: "asc" },
      select: { id: true, user: { select: { displayName: true } } },
    }),
    prisma.session.findMany({
      where: { academyId: user.academyId, students: { some: { student: { guardian: { userId: user.id } } } } },
      orderBy: { scheduledStart: "asc" },
      take: 100,
      include: {
        subject: { select: { nameEn: true, nameAr: true } },
        teacher: { include: { user: { select: { displayName: true } } } },
        students: { include: { student: { select: { id: true } } } },
      },
    }),
  ]);
  const subjectName = (subject: { nameEn: string; nameAr: string }) =>
    locale === "ar" ? subject.nameAr : subject.nameEn;

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-8 text-white sm:px-10">
        <Icon name="calendar_month" size={32} className="text-[var(--gold)]" />
        <h1 className="mt-3 text-3xl font-bold">{t("guardian.title")}</h1>
        <p className="mt-2 text-sm text-white/80">{t("guardian.subtitle")}</p>
      </section>
      {children.map((child) => {
        const childSessions = sessions.filter((session) =>
          session.students.some(({ student }) => student.id === child.id),
        );
        return (
          <section key={child.id} className="mt-6 space-y-3">
            <h2 className="text-lg font-bold text-[var(--navy)]">{child.user.displayName}</h2>
            {childSessions.map((session) => {
              const state = session.status === "SCHEDULED" ? joinWindowState(session.scheduledStart, session.scheduledEnd, now) : null;
              return (
                <article key={`${child.id}:${session.id}`} className="lift-card dashboard-card p-5">
                  <div className="flex flex-wrap justify-between gap-3">
                    <strong className="text-[var(--navy)]">{subjectName(session.subject)}</strong>
                    <span className="text-sm opacity-70">{formatSessionDateTime(session.scheduledStart, user.timezone, locale)}</span>
                  </div>
                  <p className="mt-2 text-sm opacity-70">
                    {session.teacher.user.displayName} · {t(`statuses.${session.status}`)} · {t(`types.${session.sessionType}`)}
                  </p>
                  {state ? <SessionJoinLink sessionId={session.id} state={state} label={t("openZoom")} /> : null}
                  {session.status === "SCHEDULED" || session.status === "COMPLETED" ? <SessionRequestForm sessionId={session.id} /> : null}
                </article>
              );
            })}
            {!childSessions.length ? (
              <p className="dashboard-card p-5 text-sm opacity-70">{t("guardian.noSessions", { name: child.user.displayName })}</p>
            ) : null}
          </section>
        );
      })}
      {!children.length ? <p className="dashboard-card mt-6 p-5 text-sm opacity-70">{t("empty")}</p> : null}
    </DashboardShell>
  );
}
