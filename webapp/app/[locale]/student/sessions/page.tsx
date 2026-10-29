import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import EvaluateSessionDetails from "../../../_components/evaluations/evaluate-session-details";
import SessionJoinLink from "../../../_components/session-join-link";
import SessionRequestForm from "../../../_components/session-request-form";
import Icon from "../../../_components/ui/icon";
import { requireRole, studentFinanceBlocked } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { joinWindowState } from "../../../../lib/config/session-join";
import { getJoinWindowMinutes } from "../../../../lib/sessions/join-window";
import { getOwnEvaluationsForSessions, isEvaluationsReady } from "../../../../lib/evaluations/service";
import { Link } from "../../../../i18n/navigation";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export default async function StudentSessionsPage() {
  const user = await requireRole("STUDENT");
  const financeHidden = await studentFinanceBlocked(user.id);
  const locale = await getLocale();
  const t = await getTranslations("sessions");
  const now = new Date();
  const joinWindowMinutes = await getJoinWindowMinutes(user.academyId);
  const sessions = await prisma.session.findMany({
    where: { academyId: user.academyId, students: { some: { student: { userId: user.id } } } },
    orderBy: { scheduledStart: "asc" },
    take: 100,
    include: {
      subject: { select: { nameEn: true, nameAr: true } },
      teacher: { include: { user: { select: { displayName: true } } } },
    },
  });
  const subjectName = (subject: { nameEn: string; nameAr: string }) =>
    locale === "ar" ? subject.nameAr : subject.nameEn;
  // Ended = past the scheduled end and not cancelled/missed: the student may read the
  // report and evaluate (the evaluations API re-checks roster + end server-side).
  const isEnded = (session: (typeof sessions)[number]) =>
    session.status !== "CANCELLED" && session.status !== "MISSED" && now >= session.scheduledEnd;
  // The report link appears only once the teacher has SUBMITTED a report for this
  // student (any status — CONTEXT §9 submit-time visibility; owner, 2026-10-25).
  const reportedSessionIds = new Set(
    (
      await prisma.report.findMany({
        where: {
          sessionId: { in: sessions.filter(isEnded).map((session) => session.id) },
          student: { userId: user.id },
          reportType: "SESSION_COMPLETION_REPORT",
        },
        select: { sessionId: true },
      })
    ).map((report) => report.sessionId),
  );
  const evaluationsReady = await isEvaluationsReady();
  const evaluations = evaluationsReady
    ? await getOwnEvaluationsForSessions(sessions.filter(isEnded).map((session) => session.id), { userId: user.id, role: "STUDENT" })
    : new Map();
  const tReports = await getTranslations("studentReports");

  return (
    <DashboardShell role={user.role} userName={user.displayName} hideNavKeys={financeHidden ? ["invoices"] : undefined}>
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-8 text-white sm:px-10">
        <Icon name="calendar_month" size={32} className="text-[var(--gold)]" />
        <h1 className="mt-3 text-3xl font-bold">{t("student.title")}</h1>
        <p className="mt-2 text-sm text-white/80">{t("student.subtitle")}</p>
      </section>
      <div className="mt-6 space-y-3">
        {sessions.map((session) => {
          const state = session.status === "SCHEDULED" ? joinWindowState(session.scheduledStart, session.scheduledEnd, now, joinWindowMinutes) : null;
          return (
            <article key={session.id} className="lift-card dashboard-card p-5">
              <div className="flex flex-wrap justify-between gap-3">
                <strong className="text-[var(--navy)]">{subjectName(session.subject)}</strong>
                <span className="text-sm opacity-70">{formatSessionDateTime(session.scheduledStart, user.timezone, locale)}</span>
              </div>
              <p className="mt-2 text-sm opacity-70">
                {session.teacher.user.displayName} ·{" "}
                {session.status === "SCHEDULED" && now >= session.scheduledEnd ? t("teacher.ended") : t(`statuses.${session.status}`)} ·{" "}
                {t(`types.${session.sessionType}`)}
              </p>
<<<<<<< HEAD
              {state ? <SessionJoinLink windowMinutes={joinWindowMinutes} sessionId={session.id} state={state} label={t("openZoom")} /> : null}
=======
              {state ? <SessionJoinLink sessionId={session.id} state={state} label={t("openZoom")} /> : null}
>>>>>>> a36b92a5884fce32fbf1247ff19460553cbdf488
              {isEnded(session) && reportedSessionIds.has(session.id) ? (
                <Link href={`/student/sessions/${session.id}/report`} className="mt-2 inline-block text-xs text-[var(--emerald)] underline-offset-2 hover:underline">
                  {tReports("open")}
                </Link>
              ) : null}
              {session.status === "SCHEDULED" || session.status === "COMPLETED" ? <SessionRequestForm sessionId={session.id} /> : null}
              {evaluationsReady && isEnded(session) ? (
                <EvaluateSessionDetails sessionId={session.id} label={tReports("evaluate")} evaluation={evaluations.get(session.id) ?? null} />
              ) : null}
            </article>
          );
        })}
        {!sessions.length ? <p className="dashboard-card p-5 text-sm opacity-70">{t("empty")}</p> : null}
      </div>
    </DashboardShell>
  );
}
