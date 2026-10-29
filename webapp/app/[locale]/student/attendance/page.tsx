import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "../../../../i18n/navigation";
import DashboardShell from "../../../_components/dashboard-shell";
import StatusBadge from "../../../_components/ui/status-badge";
import { requireRole, studentFinanceBlocked } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { formatSessionDateTime } from "../../../../lib/schedules/display";
import PageHeader from "../../../_components/ui/page-header";

export async function generateMetadata() {
  const t = await getTranslations("attendance");
  return { title: `${t("student.title")} | Zarabicschool` };
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
      <PageHeader title={t("student.title")} subtitle={t("student.subtitle")} />
      <div className="mt-6 space-y-3">
        {sessions.map((session) => {
          const own = session.students.find((entry) => entry.student.userId === user.id);
          if (!own) return null;
          const report = session.reports.find((entry) => entry.studentId === own.studentId);
          return (
            <article key={session.id} className="z-card rounded-xl flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <strong className="text-primary">{subjectName(session.subject)}</strong>
                <p className="mt-1 text-body-sm text-on-surface-variant">
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
          <p className="z-card rounded-xl p-5 text-body-sm text-on-surface-variant">{t("student.empty")}</p>
        ) : null}
      </div>
    </DashboardShell>
  );
}
