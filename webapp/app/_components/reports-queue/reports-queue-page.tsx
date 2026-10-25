import { getLocale, getTranslations } from "next-intl/server";

import { prisma } from "../../../lib/prisma";
import { requireRoles } from "../../../lib/dal";
import { getClassRemarkOptions, type ClassRemarkOption } from "../../../lib/reports/class-remarks";
import { resolveReportLanguage } from "../../../lib/reports/report-language";
import { isSession1ReportsReady } from "../../../lib/reports/session1-ready";
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
  // Session 1 (owner, 2026-10-18): `language` + `rejection_count` only exist after the
  // owner applies migration 20261018190000 — explicit select keeps pre-migration reads
  // working and the language/rejection UI self-heals once it lands.
  const session1Ready = await isSession1ReportsReady();
  const [pendingReports, lateFlags, approvedToday, queueTeachers, classRemarkOptions, rejectionTotals] = await Promise.all([
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
      select: {
        id: true,
        teacherId: true,
        sessionId: true,
        submittedAt: true,
        attendanceOutcome: true,
        classRemark: true,
        summary: true,
        homework: true,
        notes: true,
        extraTimeMinutes: true,
        extraTimeStatus: true,
        operationalEvents: true,
        ...(session1Ready ? { language: true, rejectionCount: true } : {}),
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
    // Class-remark options with per-language labels (Session 1, CONTEXT §9) — the
    // panel resolves the stored slug to the label in the report's language.
    getClassRemarkOptions(user.academyId),
    // Rejection counter rollup (Session 1, PROPOSAL — CONTEXT §6/§7): per-teacher
    // totals across ALL reports, informational only. Gated on the migration.
    session1Ready
      ? prisma.report.groupBy({
          by: ["teacherId"],
          where: { academyId: user.academyId, rejectionCount: { gt: 0 } },
          _sum: { rejectionCount: true },
        })
      : Promise.resolve([]),
  ]);

  const flaggedSessionIds = new Set(lateFlags.map((flag) => flag.sessionId));
  const reports: QueueReport[] = pendingReports.map((report) => ({
    id: report.id,
    sessionId: report.sessionId,
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
    ...(session1Ready
      ? {
          language: resolveReportLanguage(report.language),
          rejectionCount: report.rejectionCount ?? 0,
        }
      : {}),
  }));

  const teachers = queueTeachers.map((entry) => ({ id: entry.teacher.id, name: entry.teacher.user.displayName }));

  // Red-mark rollup (Batch D item 12): LATE_REPORT flags per teacher, so Admin and
  // Supervisor see compliance at a glance in the queue (the per-report chips remain).
  const flaggedTeacherIds = [...new Set(lateFlags.map((flag) => flag.teacherId))];
  const flaggedTeachers = flaggedTeacherIds.length
    ? await prisma.teacher.findMany({
        where: { id: { in: flaggedTeacherIds } },
        select: { id: true, user: { select: { displayName: true } } },
      })
    : [];
  const redMarks = flaggedTeachers
    .map((teacher) => ({
      name: teacher.user.displayName,
      count: lateFlags.filter((flag) => flag.teacherId === teacher.id).length,
    }))
    .sort((a, b) => b.count - a.count);

  // Rejection-counter rollup (Session 1, PROPOSAL): per-teacher totals, informational
  // only — never an automatic red mark or penalty (the red mark stays for LATE reports).
  const rejectionTeacherIds = rejectionTotals.map((row) => row.teacherId);
  const rejectionTeachers = rejectionTeacherIds.length
    ? await prisma.teacher.findMany({
        where: { id: { in: rejectionTeacherIds } },
        select: { id: true, user: { select: { displayName: true } } },
      })
    : [];
  const nameByTeacherId = new Map([
    ...flaggedTeachers.map((teacher) => [teacher.id, teacher.user.displayName] as const),
    ...rejectionTeachers.map((teacher) => [teacher.id, teacher.user.displayName] as const),
  ]);
  const rejections = rejectionTotals
    .map((row) => ({
      name: nameByTeacherId.get(row.teacherId) ?? "",
      count: row._sum.rejectionCount ?? 0,
    }))
    .filter((entry) => entry.name && entry.count > 0)
    .sort((a, b) => b.count - a.count);

  const metrics = {
    pending: reports.length,
    flagged: reports.filter((report) => report.hasLateFlag).length,
    overtime: reports.filter((report) => report.extraTimeStatus === "PENDING").length,
    approvedToday,
  };

  // Admin-only config surface (owner decision 2026-10-14): the class-remark list is a
  // system setting, so Supervisors never receive the editor.
  const classRemarks: ClassRemarkOption[] = user.role === "ADMIN" ? classRemarkOptions : [];

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone} navBadges={{ reports: metrics.pending }}>
      <PageHeader
        eyebrow={role === "ADMIN" ? tShell("scope.ADMIN") : tShell("scope.SUPERVISOR")}
        eyebrowMeta={t("gateBadge")}
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <ReportsQueuePanel
        reports={reports}
        metrics={metrics}
        teachers={teachers}
        filters={filters}
        locale={locale}
        classRemarkOptions={session1Ready ? classRemarkOptions : []}
      />
      {redMarks.length > 0 ? (
        <section className="z-card rounded-xl p-4">
          <h2 className="text-title-md font-bold text-primary">{t("redMarksTitle")}</h2>
          <p className="text-body-sm text-on-surface-variant">{t("redMarksHint")}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {redMarks.map((entry) => (
              <li key={entry.name} className="rounded bg-error-container px-2 py-1 text-body-sm text-on-error-container">
                {entry.name} · {t("redMarksCount", { count: entry.count })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {rejections.length > 0 ? (
        <section className="z-card rounded-xl p-4">
          <h2 className="text-title-md font-bold text-primary">{t("rejectionsTitle")}</h2>
          <p className="text-body-sm text-on-surface-variant">{t("rejectionsHint")}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {rejections.map((entry) => (
              <li key={entry.name} className="rounded bg-surface-container-high px-2 py-1 text-body-sm text-primary">
                {entry.name} · {t("rejectionsCount", { count: entry.count })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {user.role === "ADMIN" ? <ClassRemarksEditor initialItems={classRemarks} /> : null}
    </DashboardShell>
  );
}
