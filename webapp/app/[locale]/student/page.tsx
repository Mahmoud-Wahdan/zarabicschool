import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import PageHeader from "../../_components/ui/page-header";
import EmptyState from "../../_components/ui/empty-state";
import SessionJoinLink from "../../_components/session-join-link";
import { requireRole, studentFinanceBlocked } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { joinWindowState } from "../../../lib/config/session-join";
import { getJoinWindowMinutes } from "../../../lib/sessions/join-window";
import { getStudentLatestHomework, getStudentNextSession } from "../../../lib/dashboard/student-overview";
import { calendarPeriod, getCalendarRangeSessions } from "../../../lib/dashboard/calendar-range";
import { parseMonthParam, parseView } from "../../../lib/calendar/month";
import SessionsCalendar from "../../_components/calendar/sessions-calendar";
import { Link } from "../../../i18n/navigation";

import AnnouncementsWidget from "../../_components/announcements/announcements-widget";
import EvaluationPromptCard from "../../_components/evaluations/evaluation-prompt-card";
export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: `${t("student.title")} | Zarabicschool` };
}

export default async function StudentDashboard({ searchParams }: { searchParams: Promise<{ view?: string; week?: string; month?: string }> }) {
  const user = await requireRole("STUDENT");
  const zone = user.timezone || "Africa/Cairo";
  const now = new Date();
  const params = await searchParams;
  const view = parseView(params.view);
  const month = parseMonthParam(params.month, now, zone);
  const period = calendarPeriod(view, { week: params.week, month }, now, zone);
  // Finance wall (CONTEXT §12): a student WITH a guardian sees no finance nav at all.
  const [financeHidden, t, locale, student, joinWindowMinutes] = await Promise.all([
    studentFinanceBlocked(user.id),
    getTranslations("dashboard"),
    getLocale(),
    prisma.student.findUnique({ where: { userId: user.id }, select: { id: true } }),
    getJoinWindowMinutes(user.academyId),
  ]);
  const [nextSession, week, homework] = await Promise.all([
    student ? getStudentNextSession(student.id, now) : null,
    student ? getCalendarRangeSessions({ studentId: student.id }, period.range) : [],
    student ? getStudentLatestHomework(student.id) : null,
  ]);

  const dateLocale = locale === "ar" ? "ar-EG" : "en-GB";
  const timeFormat = new Intl.DateTimeFormat(dateLocale, { timeZone: zone, hour: "numeric", minute: "2-digit" });
  const dayFormat = new Intl.DateTimeFormat(dateLocale, { timeZone: zone, weekday: "long", day: "numeric", month: "long" });
  const shortDay = new Intl.DateTimeFormat(dateLocale, { timeZone: zone, weekday: "short", day: "numeric", month: "short" });
  const subjectName = (subject: { nameAr: string; nameEn: string }) => (locale === "ar" ? subject.nameAr : subject.nameEn);
  const nextState = nextSession ? joinWindowState(nextSession.scheduledStart, nextSession.scheduledEnd, now, joinWindowMinutes) : null;

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone} hideNavKeys={financeHidden ? ["invoices"] : undefined}>
      <AnnouncementsWidget academyId={user.academyId} timeZone={zone} />
      <EvaluationPromptCard userId={user.id} academyId={user.academyId} role="STUDENT" />
      <PageHeader title={t("student.title")} subtitle={t("student.welcome", { name: user.displayName })} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section className="z-card flex flex-col rounded-xl p-4 sm:p-6 lg:col-span-3" aria-labelledby="student-next">
          <h2 id="student-next" className="text-title-md font-semibold text-on-surface-variant">{t("student.nextTitle")}</h2>
          {nextSession && nextState ? (
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-headline-md font-bold text-primary">{subjectName(nextSession.subject)}</p>
                <p className="mt-1 text-body-md text-on-surface tabular-nums">
                  {dayFormat.format(nextSession.scheduledStart)} · {timeFormat.format(nextSession.scheduledStart)} – {timeFormat.format(nextSession.scheduledEnd)}
                </p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{t("student.withTeacher", { name: nextSession.teacher.user.displayName })}</p>
              </div>
              <div className="shrink-0">
                <SessionJoinLink windowMinutes={joinWindowMinutes} sessionId={nextSession.id} state={nextState} label={t("student.joinSession")} />
              </div>
            </div>
          ) : (
            <EmptyState icon="event_available" title={t("student.noNext")} />
          )}
        </section>

        <section className="z-card flex flex-col rounded-xl p-4 sm:p-6 lg:col-span-2" aria-labelledby="student-homework">
          <h2 id="student-homework" className="text-title-md font-semibold text-on-surface-variant">{t("student.homeworkTitle")}</h2>
          {homework ? (
            <div className="mt-3 flex flex-1 flex-col gap-3">
              <p className="text-label-md text-on-surface-variant tabular-nums">
                {subjectName(homework.session.subject)} · {shortDay.format(homework.session.scheduledStart)} · {homework.session.teacher.user.displayName}
              </p>
              <div>
                <h3 className="text-label-md font-semibold text-on-surface">{t("student.homeworkLabel")}</h3>
                <p className="mt-1 whitespace-pre-line text-body-md text-on-surface line-clamp-6">{homework.homework}</p>
              </div>
              {homework.notes ? (
                <div>
                  <h3 className="text-label-md font-semibold text-on-surface">{t("student.notesLabel")}</h3>
                  <p className="mt-1 whitespace-pre-line text-body-sm text-on-surface-variant line-clamp-4">{homework.notes}</p>
                </div>
              ) : null}
              <Link href="/student/reports" className="mt-auto text-label-md text-secondary underline-offset-2 hover:underline">{t("student.allReports")}</Link>
            </div>
          ) : (
            <EmptyState icon="description" title={t("student.metrics.notAvailable")} />
          )}
        </section>
      </div>

      <SessionsCalendar
        title={t("student.weekTitle")}
        subtitle={t("student.calendarSubtitle")}
        view={view}
        weekStart={period.weekStart}
        month={month}
        monthDays={period.grid?.days ?? null}
        sessions={week}
        now={now}
        timeZone={zone}
        locale={locale}
        basePath="/student"
        show="teacher"
        scheduleHref="/student/sessions"
        scheduleLabel={t("student.actions.schedule")}
      />
    </DashboardShell>
  );
}
