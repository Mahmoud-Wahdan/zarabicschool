import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import RosterReportAction from "../../../_components/reports/roster-report-action";
import SessionJoinLink from "../../../_components/session-join-link";
import SessionRequestForm from "../../../_components/session-request-form";
import Icon from "../../../_components/ui/icon";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { joinWindowState } from "../../../../lib/config/session-join";
import { getJoinWindowMinutes } from "../../../../lib/sessions/join-window";
import { getTeacherRosterReportStatuses, rosterKey } from "../../../../lib/reports/roster-status";
import { formatSessionDateTime } from "../../../../lib/schedules/display";
import { wallClockInputToUtc } from "../../../../lib/schedules/recurrence";

export default async function TeacherSessionsPage() {
  const user = await requireRole("TEACHER");
  const locale = await getLocale();
  const t = await getTranslations("sessions");
  const now = new Date();
<<<<<<< HEAD
  const joinWindowMinutes = await getJoinWindowMinutes(user.academyId);
=======
>>>>>>> a36b92a5884fce32fbf1247ff19460553cbdf488
  // C6 (plan approved 2026-10-25): a bounded window (7 days back … 30 days ahead)
  // instead of "the oldest 100", which hid today's sessions from a teacher with a
  // long history. The cap stays as a safety net.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const sessions = await prisma.session.findMany({
    where: {
      academyId: user.academyId,
      teacher: { userId: user.id },
      scheduledStart: { gte: new Date(now.getTime() - 7 * DAY_MS), lt: new Date(now.getTime() + 30 * DAY_MS) },
    },
    orderBy: { scheduledStart: "asc" },
    take: 200,
    include: {
      subject: { select: { nameEn: true, nameAr: true } },
      students: { select: { student: { select: { id: true, user: { select: { displayName: true } } } } } },
    },
  });
  const reportStatuses = await getTeacherRosterReportStatuses(
    user.id,
    user.academyId,
    sessions.map((session) => session.id),
  );

  // Today = the viewer's local day (DST-safe through the shared wall-clock helper).
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone }).format(now);
  const dayStart = wallClockInputToUtc(`${ymd}T00:00`, user.timezone);
  const nextYmd = new Date(new Date(`${ymd}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dayEnd = wallClockInputToUtc(`${nextYmd}T00:00`, user.timezone);
  const todays = sessions.filter((session) => session.scheduledStart >= dayStart && session.scheduledStart < dayEnd);
  const subjectName = (subject: { nameEn: string; nameAr: string }) =>
    locale === "ar" ? subject.nameAr : subject.nameEn;
  // Display only: an ended session that is not COMPLETED yet reads "ended · awaiting
  // reports (X of Y)" — the session completes when the last roster report is submitted
  // (owner, 2026-10-25). Derived from existing data; no extra status value.
  const statusLabel = (session: (typeof sessions)[number]) => {
    if (session.status !== "SCHEDULED" || now < session.scheduledEnd) return t(`statuses.${session.status}`);
    const done = session.students.filter(({ student }) => reportStatuses.has(rosterKey(session.id, student.id))).length;
    return `${t("teacher.ended")} · ${t("awaitingReports", { done, total: session.students.length })}`;
  };

  const roster = (session: (typeof sessions)[number], withZoom: boolean) => {
    const state = withZoom && session.status === "SCHEDULED" ? joinWindowState(session.scheduledStart, session.scheduledEnd, now, joinWindowMinutes) : null;
    return (
      <ul className="mt-3 space-y-2">
        {session.students.map(({ student }) => (
          <li key={student.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] p-3">
            <span className="text-sm">
              <Icon name="person" size={16} className="align-middle" /> {student.user.displayName}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {/* One button: the join link (D45 — the host link is for Admin/Supervisor only). */}
              {state ? (
                <SessionJoinLink windowMinutes={joinWindowMinutes} sessionId={session.id} state={state} label={t("teacher.zoom")} compact />
              ) : null}
              <RosterReportAction
                sessionId={session.id}
                studentId={student.id}
                sessionStatus={session.status}
                scheduledEnd={session.scheduledEnd}
                now={now}
                timezone={user.timezone}
                locale={locale}
                report={reportStatuses.get(rosterKey(session.id, student.id)) ?? null}
              />
            </span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-8 text-white sm:px-10">
        <Icon name="calendar_month" size={32} className="text-[var(--gold)]" />
        <h1 className="mt-3 text-3xl font-bold">{t("teacher.title")}</h1>
        <p className="mt-2 text-sm text-white/80">{t("teacher.subtitle")}</p>
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-bold text-[var(--navy)]">{t("teacher.today")}</h2>
        {todays.map((session) => (
          <article key={session.id} className="lift-card dashboard-card p-5">
            <div className="flex flex-wrap justify-between gap-3">
              <strong className="text-[var(--navy)]">{subjectName(session.subject)}</strong>
              <span className="text-sm opacity-70">
                {formatSessionDateTime(session.scheduledStart, user.timezone, locale)} · {statusLabel(session)} · {t(`types.${session.sessionType}`)}
              </span>
            </div>
            {roster(session, true)}
          </article>
        ))}
        {!todays.length ? <p className="dashboard-card p-5 text-sm opacity-70">{t("teacher.todayEmpty")}</p> : null}
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-bold text-[var(--navy)]">{t("teacher.upcoming")}</h2>
        {sessions.map((session) => (
          <article key={session.id} className="lift-card dashboard-card p-5">
            <div className="flex flex-wrap justify-between gap-3">
              <strong className="text-[var(--navy)]">{subjectName(session.subject)}</strong>
              <span className="text-sm opacity-70">{formatSessionDateTime(session.scheduledStart, user.timezone, locale)}</span>
            </div>
            <p className="mt-2 text-sm opacity-70">
              {statusLabel(session)} · {t(`types.${session.sessionType}`)}
            </p>
            {roster(session, true)}
            {session.status === "SCHEDULED" || session.status === "COMPLETED" ? <SessionRequestForm sessionId={session.id} /> : null}
          </article>
        ))}
        {!sessions.length ? <p className="dashboard-card p-5 text-sm opacity-70">{t("empty")}</p> : null}
      </section>
    </DashboardShell>
  );
}
