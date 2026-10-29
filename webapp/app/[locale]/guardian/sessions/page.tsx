import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import SessionJoinLink from "../../../_components/session-join-link";
import SessionRequestForm from "../../../_components/session-request-form";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { joinWindowState } from "../../../../lib/config/session-join";
import { getJoinWindowMinutes } from "../../../../lib/sessions/join-window";
import { formatSessionDateTime } from "../../../../lib/schedules/display";
import PageHeader from "../../../_components/ui/page-header";

export default async function GuardianSessionsPage() {
  const user = await requireRole("GUARDIAN");
  const locale = await getLocale();
  const t = await getTranslations("sessions");
  const now = new Date();
  const joinWindowMinutes = await getJoinWindowMinutes(user.academyId);
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
      <PageHeader title={t("guardian.title")} subtitle={t("guardian.subtitle")} />
      {children.map((child) => {
        const childSessions = sessions.filter((session) =>
          session.students.some(({ student }) => student.id === child.id),
        );
        return (
          <section key={child.id} className="mt-6 space-y-3">
            <h2 className="text-headline-sm font-bold text-primary">{child.user.displayName}</h2>
            {childSessions.map((session) => {
              const state = session.status === "SCHEDULED" ? joinWindowState(session.scheduledStart, session.scheduledEnd, now, joinWindowMinutes) : null;
              return (
                <article key={`${child.id}:${session.id}`} className="z-card lift-card rounded-xl p-5">
                  <div className="flex flex-wrap justify-between gap-3">
                    <strong className="text-primary">{subjectName(session.subject)}</strong>
                    <span className="text-body-sm text-on-surface-variant">{formatSessionDateTime(session.scheduledStart, user.timezone, locale)}</span>
                  </div>
                  <p className="mt-2 text-body-sm text-on-surface-variant">
                    {session.teacher.user.displayName} · {t(`statuses.${session.status}`)} · {t(`types.${session.sessionType}`)}
                  </p>
                  {state ? <SessionJoinLink windowMinutes={joinWindowMinutes} sessionId={session.id} state={state} label={t("openZoom")} /> : null}
                  {session.status === "SCHEDULED" || session.status === "COMPLETED" ? <SessionRequestForm sessionId={session.id} /> : null}
                </article>
              );
            })}
            {!childSessions.length ? (
              <p className="z-card rounded-xl p-5 text-body-sm text-on-surface-variant">{t("guardian.noSessions", { name: child.user.displayName })}</p>
            ) : null}
          </section>
        );
      })}
      {!children.length ? <p className="z-card rounded-xl mt-6 p-5 text-body-sm text-on-surface-variant">{t("empty")}</p> : null}
    </DashboardShell>
  );
}
