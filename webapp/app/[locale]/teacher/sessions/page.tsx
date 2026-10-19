import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import SessionJoinLink from "../../../_components/session-join-link";
import SessionRequestForm from "../../../_components/session-request-form";
import Icon from "../../../_components/ui/icon";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { joinWindowState } from "../../../../lib/config/session-join";
import { formatSessionDateTime } from "../../../../lib/schedules/display";
import { wallClockInputToUtc } from "../../../../lib/schedules/recurrence";

export default async function TeacherSessionsPage() {
  const user = await requireRole("TEACHER");
  const locale = await getLocale();
  const t = await getTranslations("sessions");
  const now = new Date();
  const sessions = await prisma.session.findMany({
    where: { academyId: user.academyId, teacher: { userId: user.id } },
    orderBy: { scheduledStart: "asc" },
    take: 100,
    include: {
      subject: { select: { nameEn: true, nameAr: true } },
      students: { select: { student: { select: { id: true, user: { select: { displayName: true } } } } } },
    },
  });

  // Today = the viewer's local day (DST-safe through the shared wall-clock helper).
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone }).format(now);
  const dayStart = wallClockInputToUtc(`${ymd}T00:00`, user.timezone);
  const nextYmd = new Date(new Date(`${ymd}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dayEnd = wallClockInputToUtc(`${nextYmd}T00:00`, user.timezone);
  const todays = sessions.filter((session) => session.scheduledStart >= dayStart && session.scheduledStart < dayEnd);
  const subjectName = (subject: { nameEn: string; nameAr: string }) =>
    locale === "ar" ? subject.nameAr : subject.nameEn;

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-8 text-white sm:px-10">
        <Icon name="calendar_month" size={32} className="text-[var(--gold)]" />
        <h1 className="mt-3 text-3xl font-bold">{t("teacher.title")}</h1>
        <p className="mt-2 text-sm text-white/80">{t("teacher.subtitle")}</p>
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-bold text-[var(--navy)]">{t("teacher.today")}</h2>
        {todays.map((session) => {
          const state = session.status === "SCHEDULED" ? joinWindowState(session.scheduledStart, session.scheduledEnd, now) : null;
          return (
            <article key={session.id} className="lift-card dashboard-card p-5">
              <div className="flex flex-wrap justify-between gap-3">
                <strong className="text-[var(--navy)]">{subjectName(session.subject)}</strong>
                <span className="text-sm opacity-70">
                  {formatSessionDateTime(session.scheduledStart, user.timezone, locale)} · {t(`statuses.${session.status}`)}
                </span>
              </div>
              <ul className="mt-3 space-y-2">
                {session.students.map(({ student }) => (
                  <li key={student.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] p-3">
                    <span className="text-sm">
                      <span className="material-symbols-outlined align-middle text-sm" aria-hidden="true">person</span>{" "}
                      {student.user.displayName} · {t(`types.${session.sessionType}`)}
                    </span>
                    {state ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <SessionJoinLink sessionId={session.id} state={state} label={t("teacher.zoom")} compact />
                        {session.zoomHostUrl ? (
                          <SessionJoinLink sessionId={session.id} state={state} label={t("teacher.startHost")} host compact />
                        ) : null}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {session.zoomHostUrl && session.status === "SCHEDULED" ? (
                <p className="mt-2 text-xs opacity-60">{t("teacher.hostNote")}</p>
              ) : null}
            </article>
          );
        })}
        {!todays.length ? <p className="dashboard-card p-5 text-sm opacity-70">{t("teacher.todayEmpty")}</p> : null}
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-bold text-[var(--navy)]">{t("teacher.upcoming")}</h2>
        {sessions.map((session) => {
          const state = session.status === "SCHEDULED" ? joinWindowState(session.scheduledStart, session.scheduledEnd, now) : null;
          return (
            <article key={session.id} className="lift-card dashboard-card p-5">
              <div className="flex flex-wrap justify-between gap-3">
                <strong className="text-[var(--navy)]">{subjectName(session.subject)}</strong>
                <span className="text-sm opacity-70">{formatSessionDateTime(session.scheduledStart, user.timezone, locale)}</span>
              </div>
              <p className="mt-2 text-sm opacity-70">
                {t(`statuses.${session.status}`)} · {t(`types.${session.sessionType}`)} ·{" "}
                {session.students.map((item) => item.student.user.displayName).join(", ")}
              </p>
              {state ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <SessionJoinLink sessionId={session.id} state={state} label={t("openZoom")} />
                  {session.zoomHostUrl ? (
                    <SessionJoinLink sessionId={session.id} state={state} label={t("teacher.startHost")} host compact />
                  ) : null}
                </div>
              ) : null}
              {session.status === "SCHEDULED" || session.status === "COMPLETED" ? <SessionRequestForm sessionId={session.id} /> : null}
            </article>
          );
        })}
        {!sessions.length ? <p className="dashboard-card p-5 text-sm opacity-70">{t("empty")}</p> : null}
      </section>
    </DashboardShell>
  );
}
