import { getLocale, getTranslations } from "next-intl/server";

import { prisma } from "../../../lib/prisma";
import { requireRoles } from "../../../lib/dal";
import { getClassRemarks } from "../../../lib/reports/class-remarks";
import { isAttachmentsReady } from "../../../lib/storage/attachment-ready";
import DashboardShell from "../dashboard-shell";
import PageHeader from "../ui/page-header";
import ClassRemarksEditor from "./class-remarks-editor";
import ReportsQueuePanel, { type QueueFilter, type QueueReport } from "./reports-queue-panel";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReportsQueuePage({
  role,
  searchParams = {},
}: {
  role: "ADMIN" | "SUPERVISOR";
  searchParams?: SearchParams;
}) {
  const user = await requireRoles([role]);
  const locale = await getLocale();
  const t = await getTranslations("reportsQueue");
  const tShell = await getTranslations("appShell");

  // Server-side queue filters (Batch B): teacher, date range, group/private.
  const filters: QueueFilter = {};
  const rawTeacher = first(searchParams.teacher);
  if (rawTeacher && /^[0-9a-f-]{36}$/i.test(rawTeacher)) filters.teacher = rawTeacher;
  const rawType = first(searchParams.type);
  if (rawType === "GROUP" || rawType === "PRIVATE") filters.type = rawType;
  const rawFrom = first(searchParams.from);
  if (rawFrom && /^\d{4}-\d{2}-\d{2}$/.test(rawFrom)) filters.from = rawFrom;
  const rawTo = first(searchParams.to);
  if (rawTo && /^\d{4}-\d{2}-\d{2}$/.test(rawTo)) filters.to = rawTo;

  const submittedAtRange = {
    ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00`) } : {}),
    ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59.999`) } : {}),
  };
  const hasRange = Object.keys(submittedAtRange).length > 0;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const attachmentsReady = await isAttachmentsReady();
  const [pendingReports, lateFlags, approvedToday, queueTeachers] = await Promise.all([
    prisma.report.findMany({
      where: {
        academyId: user.academyId,
        status: "SUBMITTED",
        ...(filters.teacher ? { teacherId: filters.teacher } : {}),
        ...(filters.type || hasRange
          ? { session: { ...(filters.type ? { sessionType: filters.type } : {}) } }
          : {}),
        ...(hasRange ? { submittedAt: submittedAtRange } : {}),
      },
      orderBy: { submittedAt: "desc" },
      include: {
        session: {
          select: {
            id: true,
            sessionType: true,
            scheduledStart: true,
            scheduledEnd: true,
            subject: { select: { nameAr: true, nameEn: true } },
          },
        },
        teacher: { select: { id: true, user: { select: { displayName: true } } } },
        student: { select: { user: { select: { displayName: true } } } },
        ...(attachmentsReady ? { attachments: { orderBy: { createdAt: "asc" as const }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true } } } : {}),
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
    // Teacher filter options: every teacher who currently has a SUBMITTED report.
    prisma.report.findMany({
      where: { academyId: user.academyId, status: "SUBMITTED" },
      select: { teacher: { select: { id: true, user: { select: { displayName: true } } } } },
      distinct: ["teacherId"],
    }),
  ]);

  const flaggedSessionIds = new Set(lateFlags.map((flag) => flag.sessionId));

  const reports: QueueReport[] = pendingReports.map((report) => ({
    id: report.id,
    teacherId: report.teacherId,
    teacherName: report.teacher.user.displayName,
    studentName: report.student.user.displayName,
    subjectName: locale === "en" ? report.session.subject.nameEn : report.session.subject.nameAr,
    sessionType: report.session.sessionType,
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
    operationalEvents: (report.operationalEvents as Record<string, unknown> | null) ?? null,
    hasLateFlag: flaggedSessionIds.has(report.sessionId),
    attachments: attachmentsReady
      ? ((report as unknown as { attachments?: { id: string; originalName: string; mimeType: string; sizeBytes: bigint }[] }).attachments ?? []).map((attachment) => ({
          id: attachment.id,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          sizeBytes: Number(attachment.sizeBytes),
        }))
      : [],
  }));

  const teachers = queueTeachers.map((entry) => ({ id: entry.teacher.id, name: entry.teacher.user.displayName }));

  const metrics = {
    pending: reports.length,
    flagged: reports.filter((report) => report.hasLateFlag).length,
    overtime: reports.filter((report) => report.extraTimeStatus === "PENDING").length,
    approvedToday,
  };

  // Admin-only config surface (owner decision 2026-10-14): the class-remark list is a
  // system setting, so Supervisors never receive the editor.
  const classRemarks = user.role === "ADMIN" ? await getClassRemarks(user.academyId) : [];

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone} navBadges={{ reports: metrics.pending }}>
      <PageHeader
        eyebrow={role === "ADMIN" ? tShell("scope.ADMIN") : tShell("scope.SUPERVISOR")}
        eyebrowMeta={t("gateBadge")}
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <ReportsQueuePanel reports={reports} metrics={metrics} teachers={teachers} filters={filters} locale={locale} />
      {user.role === "ADMIN" ? <ClassRemarksEditor initialItems={classRemarks} /> : null}
    </DashboardShell>
  );
}
