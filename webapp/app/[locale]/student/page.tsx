import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import PageHeader from "../../_components/ui/page-header";
import EmptyState from "../../_components/ui/empty-state";
import Icon from "../../_components/ui/icon";
import DataTable, { type DataRow } from "../../_components/ui/data-table";
import { type BadgeTone } from "../../_components/ui/status-badge";
import SessionJoinLink from "../../_components/session-join-link";
import { requireRole, studentFinanceBlocked } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { joinWindowState } from "../../../lib/config/session-join";
import { getJoinWindowMinutes } from "../../../lib/sessions/join-window";
import { getStudentLatestHomework, getStudentNextSession, getStudentWeekSessions } from "../../../lib/dashboard/student-overview";
import { Link } from "../../../i18n/navigation";

import AnnouncementsWidget from "../../_components/announcements/announcements-widget";
import EvaluationPromptCard from "../../_components/evaluations/evaluation-prompt-card";
export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: `${t("student.title")} | Zarabicschool` };
}

const STATUS_TONE: Record<string, BadgeTone> = { SCHEDULED: "info", COMPLETED: "success", MISSED: "danger", CANCELLED: "neutral" };

export default async function StudentDashboard() {
  const user = await requireRole("STUDENT");
  const zone = user.timezone || "Africa/Cairo";
  const now = new Date();
  // Finance wall (CONTEXT §12): a student WITH a guardian sees no finance nav at all.
  const [financeHidden, t, tSessions, locale, student, joinWindowMinutes] = await Promise.all([
    studentFinanceBlocked(user.id),
    getTranslations("dashboard"),
    getTranslations("sessions"),
    getLocale(),
    prisma.student.findUnique({ where: { userId: user.id }, select: { id: true } }),
    getJoinWindowMinutes(user.academyId),
  ]);
  const [nextSession, week, homework] = await Promise.all([
    student ? getStudentNextSession(student.id, now) : null,
    student ? getStudentWeekSessions(student.id, now, zone) : [],
    student ? getStudentLatestHomework(student.id) : null,
  ]);

  const dateLocale = locale === "ar" ? "ar-EG" : "en-GB";
  const timeFormat = new Intl.DateTimeFormat(dateLocale, { timeZone: zone, hour: "numeric", minute: "2-digit" });
  const dayFormat = new Intl.DateTimeFormat(dateLocale, { timeZone: zone, weekday: "long", day: "numeric", month: "long" });
  const shortDay = new Intl.DateTimeFormat(dateLocale, { timeZone: zone, weekday: "short", day: "numeric", month: "short" });
  const subjectName = (subject: { nameAr: string; nameEn: string }) => (locale === "ar" ? subject.nameAr : subject.nameEn);
  const nextState = nextSession ? joinWindowState(nextSession.scheduledStart, nextSession.scheduledEnd, now, joinWindowMinutes) : null;

  const weekRows: DataRow[] = week.map((session) => ({
    id: session.id,
    filter: session.status,
    cells: {
      day: { text: shortDay.format(session.scheduledStart), sort: session.scheduledStart.toISOString(), strong: true, numeric: true },
      time: { text: `${timeFormat.format(session.scheduledStart)} – ${timeFormat.format(session.scheduledEnd)}`, sort: session.scheduledStart.toISOString(), numeric: true },
      subject: { text: subjectName(session.subject) },
      teacher: { text: session.teacher.user.displayName },
      status: { text: tSessions(`statuses.${session.status}`), tone: STATUS_TONE[session.status] ?? "neutral" },
    },
  }));

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

      <section className="z-card flex flex-col gap-1 overflow-hidden rounded-xl pt-4 sm:pt-6" aria-labelledby="student-week">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 sm:px-6">
          <div>
            <h2 id="student-week" className="text-headline-sm font-bold text-primary">{t("student.weekTitle")}</h2>
            <p className="text-body-sm text-on-surface-variant">{t("student.weekSubtitle")}</p>
          </div>
          <Link href="/student/sessions" className="btn btn-soft">
            <Icon name="calendar_month" size={18} />
            <span>{t("student.actions.schedule")}</span>
          </Link>
        </div>
        <DataTable
          caption={t("student.weekTitle")}
          columns={[
            { key: "day", label: t("student.colDay") },
            { key: "time", label: t("student.colTime") },
            { key: "subject", label: t("student.colSubject") },
            { key: "teacher", label: t("student.colTeacher") },
            { key: "status", label: t("student.colStatus") },
          ]}
          rows={weekRows}
          quickFilters={["SCHEDULED", "COMPLETED", "MISSED", "CANCELLED"].map((status) => ({ key: status, label: tSessions(`statuses.${status}`) }))}
          emptyTitle={tSessions("empty")}
          emptyIcon="event_available"
          initialSort={{ key: "day", direction: "asc" }}
        />
      </section>
    </DashboardShell>
  );
}
