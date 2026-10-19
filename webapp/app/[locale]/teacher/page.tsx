import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import EmptyState from "../../_components/ui/empty-state";
import SessionJoinLink from "../../_components/session-join-link";
import { requireRole } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { joinWindowState } from "../../../lib/config/session-join";
import { wallClockInputToUtc } from "../../../lib/schedules/recurrence";
import { Link } from "../../../i18n/navigation";

export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: `${t("teacher.title")} | Zarabicschool` };
}

export default async function TeacherDashboard() {
  const user = await requireRole("TEACHER");
  const [t, tSessions, tShell] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("sessions"),
    getTranslations("appShell"),
  ]);
  const now = new Date();

  // "Today" = the teacher's local calendar day (DST-safe, same wall-clock helper as
  // the sessions page — Phase 3/4 convention).
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone }).format(now);
  const nextYmd = new Date(new Date(`${ymd}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dayStart = wallClockInputToUtc(`${ymd}T00:00`, user.timezone);
  const dayEnd = wallClockInputToUtc(`${nextYmd}T00:00`, user.timezone);

  const teacher = await prisma.teacher.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      subjects: { select: { subject: { select: { nameAr: true, nameEn: true } } } },
      sessions: {
        where: { scheduledStart: { gte: dayStart, lt: dayEnd } },
        orderBy: { scheduledStart: "asc" },
        select: {
          id: true,
          scheduledStart: true,
          scheduledEnd: true,
          sessionType: true,
          status: true,
          subject: { select: { nameAr: true, nameEn: true } },
          students: { select: { studentId: true, student: { select: { user: { select: { displayName: true } } } } } },
        },
      },
    },
  });
  const currentLocale = await getLocale();
  const formatTime = (value: Date) => new Intl.DateTimeFormat(currentLocale === "ar" ? "ar-EG" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: user.timezone,
  }).format(value);

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("teacher.title")}</h1>
      <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
        {t("teacher.welcome", { name: user.displayName })}
      </p>

      <section className="mt-6 rounded-xl border border-[var(--line)] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-[var(--navy)]">{t("teacher.sections.today")}</h2>
          <Link href="/teacher/sessions" className="text-xs text-[var(--emerald)] underline-offset-2 hover:underline">
            {t("teacher.actions.schedule")}
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {teacher?.sessions.map((session) => {
            // The report icon appears only after the scheduled end, and never for
            // cancelled/missed sessions (CONTEXT §6; Phase 5 review F-16).
            const reportable =
              now >= session.scheduledEnd &&
              session.status !== "CANCELLED" &&
              session.status !== "MISSED";
            // The Zoom button uses the shared join-window constant — never a
            // hardcoded minute figure in UI text (owner rule; Phase 9 item 9.10
            // will change the constant, not the UI).
            const state = session.status === "SCHEDULED" ? joinWindowState(session.scheduledStart, session.scheduledEnd, now) : null;
            return (
              <div key={session.id} className="rounded-lg bg-[var(--background)] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{currentLocale === "ar" ? session.subject.nameAr : session.subject.nameEn}</strong>
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{formatTime(session.scheduledStart)}</span>
                    {state ? (
                      <SessionJoinLink
                        sessionId={session.id}
                        state={state}
                        label={tSessions("openZoom")}
                        host
                        compact
                      />
                    ) : null}
                  </span>
                </div>
                <p className="mt-1 opacity-70">
                  {session.students.length} {t("teacher.metrics.students")} · {tSessions(`types.${session.sessionType}`)}
                </p>
                {reportable ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {session.students.map((student) => (
                      <Link
                        key={student.studentId}
                        href={`/teacher/sessions/${session.id}/report?studentId=${student.studentId}`}
                        className="cta-primary rounded-lg px-3 py-2 text-xs"
                      >
                        {t("teacher.actions.report")} · {student.student.user.displayName}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
          {teacher && teacher.sessions.length === 0 ? (
            <EmptyState icon="event_available" title={tSessions("empty")} />
          ) : null}
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-[var(--navy)]">{t("teacher.sections.monthly")}</h2>
          <Link href="/teacher/monthly-reports" className="cta-primary rounded-lg px-3 py-2 text-xs">
            {t("teacher.actions.monthlyReports")}
          </Link>
        </div>
        <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">{t("teacher.monthlyHint")}</p>
      </section>

      <Link href="/teacher/sessions" className="cta-secondary mt-5 rounded-xl px-4 py-2 text-sm">{t("teacher.actions.schedule")}</Link>
      <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("teacher.sections.reports")}</h2>
        <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
          {teacher?.subjects.length ?? 0} {t("teacher.metrics.subjects")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {teacher?.subjects.map(({ subject }) => (
            <span key={subject.nameEn} className="rounded-full bg-[var(--background)] px-3 py-1 text-sm">
              {currentLocale === "ar" ? subject.nameAr : subject.nameEn}
            </span>
          ))}
        </div>
      </section>
      <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("teacher.sections.salary")}</h2>
        <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">{t("teacher.metrics.salaryUnavailable")}</p>
        <Link href="/teacher/payroll" className="cta-primary mt-3 inline-block rounded-lg px-3 py-2 text-xs">
          {tShell("nav.payroll")}
        </Link>
      </section>
    </DashboardShell>
  );
}
