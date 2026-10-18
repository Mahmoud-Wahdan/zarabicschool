import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import OvertimeQueuePanel from "../../../_components/payroll/overtime-queue-panel";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("overtime");
  return { title: `${t("title")} | Zarabicschool` };
}

/** Admin overtime review queue (Admin-only: CONTEXT §7 — Supervisor sees no money). */
export default async function AdminOvertimePage() {
  const user = await requireRole("ADMIN");
  const [t, locale] = await Promise.all([getTranslations("overtime"), getLocale()]);

  const reports = await prisma.report.findMany({
    where: { academyId: user.academyId, extraTimeStatus: "PENDING", extraTimeMinutes: { gt: 0 }, status: { in: ["APPROVED", "ARCHIVED"] } },
    orderBy: { submittedAt: "desc" },
    take: 50,
    select: {
      id: true,
      extraTimeMinutes: true,
      attendanceOutcome: true,
      teacher: { select: { user: { select: { displayName: true } } } },
      student: { select: { user: { select: { displayName: true } } } },
      session: { select: { scheduledStart: true, subject: { select: { nameAr: true, nameEn: true } } } },
    },
  });

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("title")}</h1>
      <p className="mt-2 text-sm opacity-70">{t("subtitle")}</p>
      <div className="mt-4">
        <OvertimeQueuePanel
          initialRows={reports.map((report) => ({
            reportId: report.id,
            teacherName: report.teacher.user.displayName,
            studentName: report.student.user.displayName,
            sessionLabel: `${locale === "ar" ? report.session.subject.nameAr : report.session.subject.nameEn} · ${formatSessionDateTime(report.session.scheduledStart, user.timezone, locale)}`,
            minutes: report.extraTimeMinutes,
            outcome: report.attendanceOutcome === "ATTENDED" ? (locale === "ar" ? "حضر" : "Attended") : locale === "ar" ? "غائب" : "Absent",
          }))}
        />
      </div>
    </DashboardShell>
  );
}
