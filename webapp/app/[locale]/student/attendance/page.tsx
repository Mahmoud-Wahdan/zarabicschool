import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "../../../../i18n/navigation";
import DashboardShell from "../../../_components/dashboard-shell";
import Icon from "../../../_components/ui/icon";
import StatusBadge from "../../../_components/ui/status-badge";
import { requireRole, studentFinanceBlocked } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("attendance");
  return { title: `${t("student")} | Zarabicschool` };
}

/**
 * Student attendance view (Batch D): past sessions with the attendance written from
 * approved reports, and the link to the (approval-gated) report view.
 */
export default async function StudentAttendancePage() {
  const user = await requireRole("STUDENT");
  const financeHidden = await studentFinanceBlocked(user.id);
  const locale = await getLocale();
  const t = await getTranslations("attendance");
  const now = new Date();
  const sessions = await prisma.session.findMany({
    where: { academyId: user.academyId, students: { some: { student: { userId: user.id } } }, scheduledEnd: { lt: now } },
    orderBy: { scheduledStart: "desc" },
    take: 30,
    select: {
      id: true,
      status: true,
      scheduledStart: true,
      subject: { select: { nameAr: true, nameEn: true } },
      students: { select: { studentId: true, attendanceStatus: true, student: { select: { userId: true } } } },
      reports: { select: { studentId: true, status: true } },
    },
  });
  const subjectName = (subject: { nameEn: string; nameAr: string }) => (locale === "ar" ? subject.nameAr : subject.nameEn);

  return (
    <DashboardShell role={user.role} userName={user.displayName} hideNavKeys={financeHidden ? ["invoices"] : undefined}>
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-8 text-white sm:px-10">
        <Icon name="event_available" size={32} className="text-[var(--gold)]" />
        <h1 className="mt-3 text-3xl font-bold">{t("student.title")}</h1>
        <p className="mt-2 text-sm text-white/80">{t("student.subtitle")}</p>
      </section>
      <div className="mt-6 space-y-3">
        {sessions.map((session) => {
          const own = session.students.find((entry) => entry.student.userId === user.id);
          if (!own) return null;
          const report = session.reports.find((entry) => entry.studentId === own.studentId);
          return (
            <article key={session.id} className="dashboard-card flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <strong className="text-[var(--navy)]">{subjectName(session.subject)}</strong>
                <p className="mt-1 text-sm opacity-70">
                  {formatSessionDateTime(session.scheduledStart, user.timezone, locale)} · {t(`sessionStatuses.${session.status}`)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={own.attendanceStatus === "ATTENDED" ? "success" : own.attendanceStatus === "STUDENT_ABSENT" ? "danger" : "pending"}>
                  {t(`attendanceStatuses.${own.attendanceStatus}`)}
                </StatusBadge>
                {report ? (
                  <Link href={`/student/sessions/${session.id}/report`} className="btn btn-soft text-xs">
                    {t("student.viewReport")}
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
        {!sessions.length ? (
          <p className="dashboard-card p-5 text-sm opacity-70">{t("student.empty")}</p>
        ) : null}
      </div>
    </DashboardShell>
  );
}
