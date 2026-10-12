import { getLocale, getTranslations } from "next-intl/server";

import { prisma } from "../../../lib/prisma";
import { requireRoles } from "../../../lib/dal";
import DashboardShell from "../dashboard-shell";
import PageHeader from "../ui/page-header";
import ReportsQueuePanel, { type QueueReport } from "./reports-queue-panel";

export default async function ReportsQueuePage({ role }: { role: "ADMIN" | "SUPERVISOR" }) {
  const user = await requireRoles([role]);
  const locale = await getLocale();
  const t = await getTranslations("reportsQueue");
  const tShell = await getTranslations("appShell");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [pendingReports, lateFlags, approvedToday] = await Promise.all([
    prisma.report.findMany({
      where: { academyId: user.academyId, status: "SUBMITTED" },
      orderBy: { submittedAt: "desc" },
      include: {
        session: {
          select: {
            id: true,
            scheduledStart: true,
            scheduledEnd: true,
            subject: { select: { nameAr: true, nameEn: true } },
          },
        },
        teacher: { select: { user: { select: { displayName: true } } } },
        student: { select: { user: { select: { displayName: true } } } },
      },
    }),
    prisma.teacherFlag.findMany({
      where: {
        academyId: user.academyId,
        flagType: "LATE_REPORT",
        session: {
          reports: { some: { academyId: user.academyId, status: "SUBMITTED" } },
        },
      },
      select: { sessionId: true, teacherId: true },
    }),
    prisma.report.count({
      where: {
        academyId: user.academyId,
        status: "APPROVED",
        approvedAt: { gte: startOfDay },
      },
    }),
  ]);

  const flaggedSessionIds = new Set(lateFlags.map((flag) => flag.sessionId));

  const reports: QueueReport[] = pendingReports.map((report) => ({
    id: report.id,
    teacherName: report.teacher.user.displayName,
    studentName: report.student.user.displayName,
    subjectName: locale === "en" ? report.session.subject.nameEn : report.session.subject.nameAr,
    scheduledStart: report.session.scheduledStart.toISOString(),
    scheduledEnd: report.session.scheduledEnd.toISOString(),
    submittedAt: report.submittedAt.toISOString(),
    attendanceOutcome: report.attendanceOutcome,
    classRemark: report.classRemark,
    summary: report.summary,
    homework: report.homework,
    notes: report.notes,
    extraTimeMinutes: report.extraTimeMinutes,
    extraTimeStatus: report.extraTimeStatus,
    hasLateFlag: flaggedSessionIds.has(report.sessionId),
  }));

  const metrics = {
    pending: reports.length,
    flagged: reports.filter((report) => report.hasLateFlag).length,
    overtime: reports.filter((report) => report.extraTimeStatus === "PENDING").length,
    approvedToday,
  };

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone} navBadges={{ reports: metrics.pending }}>
      <PageHeader
        eyebrow={role === "ADMIN" ? tShell("scope.ADMIN") : tShell("scope.SUPERVISOR")}
        eyebrowMeta={t("gateBadge")}
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <ReportsQueuePanel reports={reports} metrics={metrics} locale={locale} />
    </DashboardShell>
  );
}
