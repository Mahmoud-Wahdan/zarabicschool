import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import DashboardShell from "../../../../../_components/dashboard-shell";
import { requireRole } from "../../../../../../lib/dal";
import { prisma } from "../../../../../../lib/prisma";
import { getClassRemarks } from "../../../../../../lib/reports/class-remarks";
import { Link } from "../../../../../../i18n/navigation";
import ReportForm from "./report-form";

export default async function TeacherReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ studentId?: string }>;
}) {
  const user = await requireRole("TEACHER");
  const { id } = await params;
  const { studentId } = await searchParams;
  const t = await getTranslations("teacherReport");
  const locale = await getLocale();

  const session = await prisma.session.findFirst({
    where: { id, academyId: user.academyId, teacher: { userId: user.id } },
    select: {
      id: true,
      status: true,
      scheduledEnd: true,
      sessionType: true,
      subject: { select: { nameAr: true, nameEn: true } },
      students: {
        select: { studentId: true, student: { select: { user: { select: { displayName: true } } } } },
      },
    },
  });
  if (!session) notFound();

  const subjectName = locale === "en" ? session.subject.nameEn : session.subject.nameAr;
  const ended = new Date() >= session.scheduledEnd;

  if (session.status === "CANCELLED" || session.status === "MISSED") {
    return (
      <DashboardShell role={user.role} userName={user.displayName}>
        <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
        <p className="mt-3 rounded-lg bg-surface-container-low px-4 py-3 text-body-md text-on-surface-variant">
          {t("notReportable")}
        </p>
      </DashboardShell>
    );
  }
  if (!ended) {
    return (
      <DashboardShell role={user.role} userName={user.displayName}>
        <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
        <p className="mt-3 rounded-lg bg-surface-container-low px-4 py-3 text-body-md text-on-surface-variant">
          {t("notFinished", {
            time: new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(session.scheduledEnd),
          })}
        </p>
      </DashboardShell>
    );
  }

  // Group sessions pick a student first (CONTEXT §6); private sessions resolve automatically.
  let activeStudentId = studentId ?? null;
  if (!activeStudentId && session.students.length === 1) {
    activeStudentId = session.students[0].studentId;
  }
  if (!activeStudentId) {
    const reports = await prisma.report.findMany({
      where: { sessionId: session.id, reportType: "SESSION_COMPLETION_REPORT" },
      select: { studentId: true, status: true },
    });
    const statusByStudent = new Map(reports.map((report) => [report.studentId, report.status]));
    return (
      <DashboardShell role={user.role} userName={user.displayName}>
        <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
        <p className="mt-1 text-body-sm text-on-surface-variant">{subjectName}</p>
        <h2 className="mt-5 text-title-md font-bold text-primary">{t("pickerTitle")}</h2>
        <div className="mt-3 flex flex-col gap-2">
          {session.students.map((student) => {
            const status = statusByStudent.get(student.studentId);
            return (
              <Link
                key={student.studentId}
                href={`/teacher/sessions/${session.id}/report?studentId=${student.studentId}`}
                className="flex items-center justify-between rounded-xl bg-surface-container-lowest px-4 py-3 text-body-md text-on-surface shadow-sm hover:shadow-md"
              >
                <span>{student.student.user.displayName}</span>
                {status ? (
                  <span className="rounded bg-surface-container px-2 py-0.5 text-label-sm text-on-surface-variant">{t("reported")}</span>
                ) : (
                  <span className="rounded bg-error-container px-2 py-0.5 text-label-sm font-semibold text-on-error-container">{t("missing")}</span>
                )}
              </Link>
            );
          })}
        </div>
      </DashboardShell>
    );
  }

  const rosterEntry = session.students.find((student) => student.studentId === activeStudentId);
  if (!rosterEntry) notFound();

  const [existing, classRemarks] = await Promise.all([
    prisma.report.findFirst({
      where: { sessionId: session.id, studentId: activeStudentId, reportType: "SESSION_COMPLETION_REPORT" },
      select: {
        id: true,
        status: true,
        attendanceOutcome: true,
        classRemark: true,
        summary: true,
        homework: true,
        notes: true,
        extraTimeMinutes: true,
        operationalEvents: true,
        rejectionReason: true,
        attachments: { orderBy: { createdAt: "asc" as const }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
      },
    }),
    getClassRemarks(user.academyId),
  ]);

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">
        {rosterEntry.student.user.displayName} · {subjectName}
      </p>
      <ReportForm
        sessionId={session.id}
        studentId={activeStudentId}
        classRemarks={classRemarks}
        initial={
          existing
            ? {
                id: existing.id,
                status: existing.status,
                attendanceOutcome: existing.attendanceOutcome,
                classRemark: existing.classRemark,
                summary: existing.summary,
                homework: existing.homework,
                notes: existing.notes ?? "",
                extraTimeMinutes: existing.extraTimeMinutes,
                operationalEvents: existing.operationalEvents === null ? "" : JSON.stringify(existing.operationalEvents, null, 2),
                rejectionReason: existing.rejectionReason,
              }
            : null
        }
        attachments={
          existing
            ? existing.attachments.map((attachment) => ({
                id: attachment.id,
                originalName: attachment.originalName,
                mimeType: attachment.mimeType,
                sizeBytes: Number(attachment.sizeBytes),
              }))
            : []
        }
      />
    </DashboardShell>
  );
}
