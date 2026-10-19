import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import DashboardShell from "@/app/_components/dashboard-shell";
import Icon from "@/app/_components/ui/icon";
import EmptyState from "@/app/_components/ui/empty-state";
import StatusBadge from "@/app/_components/ui/status-badge";
import { requireRoles } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/payments/format";
import { getClassRemarkOptions } from "@/lib/reports/class-remarks";
import { isSession1ReportsReady } from "@/lib/reports/session1-ready";
import { classRemarkLabel, reportDir, resolveReportLanguage } from "@/lib/reports/report-language";
import { getReportForViewer } from "@/lib/reports/visibility";
import { formatSessionDateTime } from "@/lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("adminSessionDetail");
  return { title: `${t("title")} | Zarabicschool` };
}

type ReportExtra = {
  studentId: string;
  language: string | null;
  rejectionCount: number;
};

/**
 * Admin/Supervisor session-detail page (owner, 2026-10-18 — CONTEXT §9): a
 * READ-ONLY, side-by-side record of the evidence for ONE session — the teacher's
 * report per student, the student's evaluation, the guardian's evaluation (both
 * arrive with Phase 7; the panel is reserved), recorded attendance, and settlement
 * history. THE SYSTEM RECORDS, THE ADMIN DECIDES: the page never compares reports
 * against evaluations, never flags conflicts, never decides who is right.
 *
 * Money panels (ledger rows, amounts) are ADMIN-only — a Supervisor's data layer
 * omits them entirely (server-side, not just hidden).
 */
export default async function AdminSessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const { id } = await params;
  const locale = await getLocale();
  const t = await getTranslations("adminSessionDetail");
  const tSessions = await getTranslations("sessions");
  const session1Ready = await isSession1ReportsReady();

  const session = await prisma.session.findFirst({
    where: { id, academyId: user.academyId },
    select: {
      id: true,
      status: true,
      sessionType: true,
      scheduledStart: true,
      scheduledEnd: true,
      timezone: true,
      subject: { select: { nameAr: true, nameEn: true } },
      teacher: { select: { user: { select: { displayName: true } } } },
      students: {
        select: {
          attendanceStatus: true,
          studentId: true,
          student: { select: { user: { select: { displayName: true } } } },
        },
      },
    },
  });
  if (!session) notFound();

  const classRemarkOptions = await getClassRemarkOptions(user.academyId);
  const viewer = { userId: user.id, academyId: user.academyId, role: user.role } as const;

  const reportExtras: ReportExtra[] = session1Ready
    ? await (prisma.report as any).findMany({
        where: { sessionId: session.id, reportType: "SESSION_COMPLETION_REPORT" },
        select: { studentId: true, language: true, rejectionCount: true },
      })
    : [];
  const extrasByStudent = new Map<string, ReportExtra>(reportExtras.map((row: ReportExtra) => [row.studentId, row]));

  const roster = await Promise.all(
    session.students.map(async (entry: (typeof session.students)[number]) => ({
      ...entry,
      view: await getReportForViewer(viewer, session.id, entry.studentId),
    })),
  );

  // Settlement history (ADMIN only — the Supervisor data layer omits money entirely).
  const settlement =
    user.role === "ADMIN"
      ? {
          payroll: await prisma.payrollLedger.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: "asc" },
            select: { entryType: true, amountMinor: true, currency: true, minutesCredited: true, hourlyRateSnapshotMinor: true, createdAt: true },
          }),
          deductions: await prisma.subscriptionLedger.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: "asc" },
            select: { entryType: true, sessionsDelta: true, createdAt: true },
          }),
        }
      : null;

  const subjectName = locale === "en" ? session.subject.nameEn : session.subject.nameAr;

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {subjectName} · {session.teacher.user.displayName} ·{" "}
            {formatSessionDateTime(session.scheduledStart, user.timezone, locale)} —{" "}
            {formatSessionDateTime(session.scheduledEnd, user.timezone, locale)} ({session.timezone})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={session.status === "COMPLETED" ? "success" : session.status === "CANCELLED" || session.status === "MISSED" ? "danger" : "pending"}>
            {tSessions(`statuses.${session.status}`)}
          </StatusBadge>
          <StatusBadge tone="info">{tSessions(`types.${session.sessionType}`)}</StatusBadge>
        </div>
      </div>

      <p className="mt-3 rounded-lg bg-surface-container-low px-4 py-2.5 text-body-sm text-on-surface-variant">
        {t("recordingPrinciple")}
      </p>

      <section className="mt-6 flex flex-col gap-4">
        <h2 className="text-title-md font-bold text-primary">{t("perStudentTitle")}</h2>
        {roster.length === 0 ? (
          <EmptyState icon="person_off" title={t("noStudents")} />
        ) : (
          roster.map((entry) => {
            const extra = extrasByStudent.get(entry.studentId);
            const language = resolveReportLanguage(extra?.language);
            return (
              <article key={entry.studentId} className="z-card flex flex-col gap-3 rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-container text-sm font-bold text-on-primary">
                      {entry.student.user.displayName.trim().slice(0, 1).toUpperCase() || "?"}
                    </span>
                    <p className="text-title-md font-bold text-primary">{entry.student.user.displayName}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge tone={entry.attendanceStatus === "ATTENDED" ? "success" : entry.attendanceStatus === "STUDENT_ABSENT" ? "danger" : "pending"}>
                      {t(`attendance.${entry.attendanceStatus}`)}
                    </StatusBadge>
                    {extra && extra.rejectionCount > 0 ? (
                      <span className="rounded bg-surface-container-high px-2 py-0.5 text-label-sm font-semibold text-primary">
                        {t("rejectionsChip", { count: extra.rejectionCount })}
                      </span>
                    ) : null}
                  </div>
                </div>

                {entry.view ? (
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {/* The teacher's report — content in the language it was written (CONTEXT §9). */}
                    <div className="flex flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
                      <p className="text-label-md font-bold text-primary">{t("teacherReportPanel")}</p>
                      <div className="flex flex-col gap-2" dir={reportDir(language)} lang={language}>
                        {entry.view.classRemark ? (
                          <p className="text-body-sm text-on-surface">
                            <strong>{t("remark")}:</strong>{" "}
                            {session1Ready && extra ? classRemarkLabel(classRemarkOptions, entry.view.classRemark, language) : entry.view.classRemark}
                          </p>
                        ) : null}
                        {entry.view.summary ? <p className="text-body-sm text-on-surface"><strong>{t("summary")}:</strong> {entry.view.summary}</p> : null}
                        {entry.view.homework ? <p className="text-body-sm text-on-surface"><strong>{t("homework")}:</strong> {entry.view.homework}</p> : null}
                        {entry.view.notes ? <p className="text-body-sm text-on-surface"><strong>{t("notes")}:</strong> {entry.view.notes}</p> : null}
                        {entry.view.attachments.length > 0 ? (
                          <p className="text-label-sm text-on-surface-variant">{t("attachmentsCount", { count: entry.view.attachments.length })}</p>
                        ) : null}
                        <p className="text-label-sm text-on-surface-variant">
                          <Icon name="translate" size={14} className="inline align-middle" /> {t("languageChip")}: {language}
                        </p>
                      </div>
                    </div>

                    {/* Evaluations arrive with Phase 7 — the panel is reserved, never
                        auto-compared (THE SYSTEM RECORDS, THE ADMIN DECIDES). */}
                    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-outline-variant bg-surface-container-low p-3">
                      <p className="text-label-md font-bold text-primary">{t("evaluationsPanel")}</p>
                      <p className="text-body-sm text-on-surface-variant">{t("evaluationsPending")}</p>
                    </div>
                  </div>
                ) : (
                  <p className="rounded-lg bg-surface-container-low px-3 py-2 text-body-sm text-on-surface-variant">{t("reportMissing")}</p>
                )}
              </article>
            );
          })
        )}
      </section>

      {settlement ? (
        <section className="z-card mt-6 flex flex-col gap-3 rounded-xl p-4">
          <h2 className="text-title-md font-bold text-primary">{t("settlementTitle")}</h2>
          <p className="text-body-sm text-on-surface-variant">{t("settlementHint")}</p>
          {settlement.payroll.length === 0 && settlement.deductions.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">{t("settlementEmpty")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {settlement.payroll.map((entry, index: number) => (
                <div key={`payroll-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-body-sm">
                  <span className="font-semibold text-primary">{t(`payrollType.${entry.entryType}`)}</span>
                  <span className="text-on-surface">
                    {formatMoney(entry.amountMinor, entry.currency, locale)}
                    {entry.minutesCredited !== null ? ` · ${entry.minutesCredited}m` : ""}
                  </span>
                  <span className="text-label-sm text-on-surface-variant">
                    {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(entry.createdAt)}
                  </span>
                </div>
              ))}
              {settlement.deductions.map((entry, index: number) => (
                <div key={`deduction-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-body-sm">
                  <span className="font-semibold text-primary">{t(`deductionType.${entry.entryType}`)}</span>
                  <span className="text-on-surface">{entry.sessionsDelta > 0 ? `+${entry.sessionsDelta}` : entry.sessionsDelta}</span>
                  <span className="text-label-sm text-on-surface-variant">
                    {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(entry.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </DashboardShell>
  );
}

