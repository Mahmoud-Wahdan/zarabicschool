import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import PageHeader from "../../_components/ui/page-header";
import EmptyState from "../../_components/ui/empty-state";
import DataTable, { type DataRow } from "../../_components/ui/data-table";
import Icon from "../../_components/ui/icon";
import { type BadgeTone } from "../../_components/ui/status-badge";
import SessionJoinLink from "../../_components/session-join-link";
import { requireRole } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { joinWindowState } from "../../../lib/config/session-join";
import { getJoinWindowMinutes } from "../../../lib/sessions/join-window";
import { currentMonthKey, formatMonthLabel, previousMonthKey } from "../../../lib/reports/month-key";
import { eligibleMonthlyStudents } from "../../../lib/reports/monthly";
import { getTeacherNextSession, getTeacherReportsToWrite, getTeacherWeekSessions } from "../../../lib/dashboard/teacher-overview";
import { Link } from "../../../i18n/navigation";

import AnnouncementsWidget from "../../_components/announcements/announcements-widget";
export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: `${t("teacher.title")} | Zarabicschool` };
}

export default async function TeacherDashboard() {
  const user = await requireRole("TEACHER");
  const [t, tSessions] = await Promise.all([getTranslations("dashboard"), getTranslations("sessions")]);
  const now = new Date();

  const zone = user.timezone || "Africa/Cairo";
  const [joinWindowMinutes, teacher, currentLocale] = await Promise.all([
    getJoinWindowMinutes(user.academyId),
    prisma.teacher.findUnique({ where: { userId: user.id }, select: { id: true } }),
    getLocale(),
  ]);
  // In-app monthly-report reminder (owner decision 7, 2026-10-26): missing reports for
  // the PREVIOUS month in the teacher's calendar — the same month and eligibility rule
  // as the WhatsApp reminders and the Admin flag. Shown all month until submitted.
  const lastMonthKey = previousMonthKey(currentMonthKey(user.timezone || "Africa/Cairo", now));
  const [nextSession, week, reportsToWrite, monthly] = await Promise.all([
    teacher ? getTeacherNextSession(teacher.id, now) : null,
    teacher ? getTeacherWeekSessions(teacher.id, now, zone) : [],
    teacher ? getTeacherReportsToWrite(teacher.id, now) : [],
    teacher
      ? Promise.all([
          eligibleMonthlyStudents(teacher.id, lastMonthKey),
          prisma.monthlyReport.findMany({ where: { teacherId: teacher.id, monthKey: lastMonthKey }, select: { studentId: true } }),
        ])
      : null,
  ]);
  let monthlyMissing = 0;
  if (monthly) {
    const [eligible, submitted] = monthly;
    const submittedIds = new Set(submitted.map((row) => row.studentId));
    monthlyMissing = eligible.filter((student) => !submittedIds.has(student.studentId)).length;
  }
  const dateLocale = currentLocale === "ar" ? "ar-EG" : "en-GB";
  const timeFormat = new Intl.DateTimeFormat(dateLocale, { timeZone: zone, hour: "numeric", minute: "2-digit" });
  const dayFormat = new Intl.DateTimeFormat(dateLocale, { timeZone: zone, weekday: "long", day: "numeric", month: "long" });
  const shortDay = new Intl.DateTimeFormat(dateLocale, { timeZone: zone, weekday: "short", day: "numeric", month: "short" });
  const subjectName = (subject: { nameAr: string; nameEn: string }) => (currentLocale === "ar" ? subject.nameAr : subject.nameEn);
  const separator = currentLocale === "ar" ? "، " : ", ";
  const nextState = nextSession ? joinWindowState(nextSession.scheduledStart, nextSession.scheduledEnd, now, joinWindowMinutes) : null;
  const statusTone: Record<string, BadgeTone> = { SCHEDULED: "info", COMPLETED: "success", MISSED: "danger", CANCELLED: "neutral" };

  const weekRows: DataRow[] = week.map((session) => ({
    id: session.id,
    filter: session.status,
    cells: {
      day: { text: shortDay.format(session.scheduledStart), sort: session.scheduledStart.toISOString(), strong: true, numeric: true },
      time: { text: `${timeFormat.format(session.scheduledStart)} – ${timeFormat.format(session.scheduledEnd)}`, sort: session.scheduledStart.toISOString(), numeric: true },
      subject: { text: subjectName(session.subject) },
      students: { text: session.students.map((row) => row.student.user.displayName).join(separator) || "—" },
      type: { text: tSessions(`types.${session.sessionType}`) },
      status: { text: tSessions(`statuses.${session.status}`), tone: statusTone[session.status] ?? "neutral" },
    },
  }));

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <AnnouncementsWidget academyId={user.academyId} timeZone={zone} />
      <PageHeader title={t("teacher.title")} subtitle={t("teacher.welcome", { name: user.displayName })} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section className="z-card flex flex-col rounded-xl p-4 sm:p-6 lg:col-span-3" aria-labelledby="teacher-next">
          <h2 id="teacher-next" className="text-title-md font-semibold text-on-surface-variant">{t("teacher.nextTitle")}</h2>
          {nextSession && nextState ? (
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-headline-md font-bold text-primary">{subjectName(nextSession.subject)}</p>
                <p className="mt-1 text-body-md text-on-surface tabular-nums">
                  {dayFormat.format(nextSession.scheduledStart)} · {timeFormat.format(nextSession.scheduledStart)} – {timeFormat.format(nextSession.scheduledEnd)}
                </p>
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  {tSessions(`types.${nextSession.sessionType}`)} · {nextSession.students.map((row) => row.student.user.displayName).join(separator) || "—"}
                </p>
              </div>
              <div className="shrink-0">
                <SessionJoinLink windowMinutes={joinWindowMinutes} sessionId={nextSession.id} state={nextState} label={t("teacher.joinSession")} />
              </div>
            </div>
          ) : (
            <EmptyState icon="event_available" title={t("teacher.noNext")} />
          )}
        </section>

        <section className="z-card flex flex-col rounded-xl p-4 sm:p-6 lg:col-span-2" aria-labelledby="teacher-reports">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="teacher-reports" className="text-title-md font-semibold text-on-surface-variant">{t("teacher.reportsTitle")}</h2>
            <span className={`badge ${reportsToWrite.length ? "badge--pending" : "badge--neutral"} tabular-nums`}>{reportsToWrite.length}</span>
          </div>
          {reportsToWrite.length ? (
            <ul className="mt-2 -mx-2 flex flex-col">
              {reportsToWrite.slice(0, 6).map((item) => (
                <li key={`${item.sessionId}:${item.studentId}`}>
                  <Link
                    href={`/teacher/sessions/${item.sessionId}/report?studentId=${item.studentId}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-container-low"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-body-md text-on-surface">{item.studentName} · {subjectName(item.subject)}</span>
                      <span className="block text-label-sm text-on-surface-variant tabular-nums">{shortDay.format(item.scheduledStart)} · {timeFormat.format(item.scheduledStart)}</span>
                    </span>
                    <span className={`badge ${item.state === "rejected" ? "badge--danger" : "badge--pending"} shrink-0`}>
                      {item.state === "rejected" ? t("teacher.reportRejected") : t("teacher.reportMissing")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="task_alt" title={t("teacher.reportsDone")} />
          )}
          {reportsToWrite.length > 6 ? (
            <Link href="/teacher/sessions" className="mt-2 text-label-md text-secondary underline-offset-2 hover:underline">{t("teacher.reportsMore", { count: reportsToWrite.length - 6 })}</Link>
          ) : null}
          {monthlyMissing > 0 ? (
            <Link
              href={`/teacher/monthly-reports?month=${lastMonthKey}`}
              className="mt-auto flex items-center gap-2 rounded-lg bg-error-container/60 px-3 py-2 text-body-sm font-semibold text-on-error-container"
            >
              <Icon name="flag" size={18} />
              {t("teacher.monthlyMissing", { count: monthlyMissing, month: formatMonthLabel(lastMonthKey, currentLocale === "en" ? "en" : "ar") })}
            </Link>
          ) : null}
        </section>
      </div>

      <section className="z-card flex flex-col gap-1 overflow-hidden rounded-xl pt-4 sm:pt-6" aria-labelledby="teacher-week">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 sm:px-6">
          <div>
            <h2 id="teacher-week" className="text-headline-sm font-bold text-primary">{t("teacher.weekTitle")}</h2>
            <p className="text-body-sm text-on-surface-variant">{t("teacher.weekSubtitle")}</p>
          </div>
          <Link href="/teacher/sessions" className="btn btn-soft">
            <Icon name="calendar_month" size={18} />
            <span>{t("teacher.actions.schedule")}</span>
          </Link>
        </div>
        <DataTable
          caption={t("teacher.weekTitle")}
          columns={[
            { key: "day", label: t("teacher.colDay") },
            { key: "time", label: t("teacher.colTime") },
            { key: "subject", label: t("teacher.colSubject") },
            { key: "students", label: t("teacher.colStudents"), sortable: false },
            { key: "type", label: t("teacher.colType") },
            { key: "status", label: t("teacher.colStatus") },
          ]}
          rows={weekRows}
          quickFilters={["SCHEDULED", "COMPLETED", "MISSED", "CANCELLED"].map((status) => ({ key: status, label: tSessions(`statuses.${status}`) }))}
          exportName="my-week-sessions"
          emptyTitle={tSessions("empty")}
          emptyIcon="event_available"
          initialSort={{ key: "day", direction: "asc" }}
        />
      </section>
    </DashboardShell>
  );
}
