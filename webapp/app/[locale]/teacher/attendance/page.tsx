import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import Icon from "../../../_components/ui/icon";
import StatusBadge from "../../../_components/ui/status-badge";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("attendance");
  return { title: `${t("teacher")} | Zarabicschool` };
}

/**
 * Teacher attendance view (Batch D): past sessions with the per-student attendance
 * written from approved reports (PENDING / ATTENDED / STUDENT_ABSENT) and the report
 * status incl. MISSING — a missing report never changes the session status.
 */
export default async function TeacherAttendancePage() {
  const user = await requireRole("TEACHER");
  const locale = await getLocale();
  const t = await getTranslations("attendance");
  const now = new Date();
  const sessions = await prisma.session.findMany({
    where: { academyId: user.academyId, teacher: { userId: user.id }, scheduledEnd: { lt: now } },
    orderBy: { scheduledStart: "desc" },
    take: 30,
    select: {
      id: true,
      status: true,
      scheduledStart: true,
      subject: { select: { nameAr: true, nameEn: true } },
      students: {
        select: {
          studentId: true,
          attendanceStatus: true,
          student: { select: { user: { select: { displayName: true } } } },
        },
      },
      reports: { select: { studentId: true, status: true } },
    },
  });
  const subjectName = (subject: { nameEn: string; nameAr: string }) => (locale === "ar" ? subject.nameAr : subject.nameEn);
  const reportStatusFor = (session: { reports: { studentId: string; status: string }[] }, studentId: string) =>
    session.reports.find((report) => report.studentId === studentId)?.status ?? "MISSING";

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-8 text-white sm:px-10">
        <Icon name="fact_check" size={32} className="text-[var(--gold)]" />
        <h1 className="mt-3 text-3xl font-bold">{t("teacher.title")}</h1>
        <p className="mt-2 text-sm text-white/80">{t("teacher.subtitle")}</p>
      </section>
      <div className="mt-6 space-y-3">
        {sessions.map((session) => (
          <article key={session.id} className="dashboard-card p-5">
            <div className="flex flex-wrap justify-between gap-2">
              <strong className="text-[var(--navy)]">{subjectName(session.subject)}</strong>
              <span className="text-sm opacity-70">
                {formatSessionDateTime(session.scheduledStart, user.timezone, locale)} · {t(`sessionStatuses.${session.status}`)}
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {session.students.map(({ studentId, attendanceStatus, student }) => (
                <li key={studentId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] p-3">
                  <span className="text-sm">{student.user.displayName}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge
                      tone={attendanceStatus === "ATTENDED" ? "success" : attendanceStatus === "STUDENT_ABSENT" ? "danger" : "pending"}
                    >
                      {t(`attendanceStatuses.${attendanceStatus}`)}
                    </StatusBadge>
                    <span className="rounded bg-surface-container px-2 py-0.5 text-label-sm text-on-surface-variant">
                      {t(`reportStatuses.${reportStatusFor(session, studentId)}`)}
                    </span>
                  </span>
                </li>
              ))}
              {session.students.length === 0 ? <li className="text-sm opacity-70">{t("noStudents")}</li> : null}
            </ul>
          </article>
        ))}
        {!sessions.length ? (
          <p className="dashboard-card p-5 text-sm opacity-70">{t("teacher.empty")}</p>
        ) : null}
      </div>
    </DashboardShell>
  );
}
