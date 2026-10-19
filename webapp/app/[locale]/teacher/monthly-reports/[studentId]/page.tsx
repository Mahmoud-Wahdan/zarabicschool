import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "../../../../../i18n/navigation";

import DashboardShell from "../../../../_components/dashboard-shell";
import MonthlyReportContent from "../../../../_components/monthly/monthly-report-content";
import EmptyState from "../../../../_components/ui/empty-state";
import { requireRole } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { currentMonthKey, formatMonthLabel, isValidMonthKey, previousMonthKey } from "../../../../../lib/reports/month-key";
import { computeRescheduledSessions, eligibleMonthlyStudents, isMonthlyReportEditable } from "../../../../../lib/reports/monthly";
import { isSession1ReportsReady } from "../../../../../lib/reports/session1-ready";
import MonthlyReportForm from "./monthly-report-form";

export async function generateMetadata() {
  const t = await getTranslations("teacherMonthly");
  return { title: `${t("formTitle")} | Zarabicschool` };
}

/**
 * Teacher monthly report form (Session 1 — CONTEXT §9): only for an eligible
 * (teacher, student) pair and a month that has started; editable for 7 days
 * after submission, then locked (PROPOSAL). The "sessions rescheduled" figure is
 * computed from real data and read-only.
 */
export default async function TeacherMonthlyReportFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; studentId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireRole("TEACHER");
  const { studentId } = await params;
  const { month } = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations("teacherMonthly");
  const ready = await isSession1ReportsReady();

  const currentMonth = currentMonthKey(user.timezone || "Africa/Cairo");
  const monthKey = month && isValidMonthKey(month) && month <= currentMonth ? month : previousMonthKey(currentMonth);

  if (!ready) {
    return (
      <DashboardShell role={user.role} userName={user.displayName}>
        <h1 className="text-headline-md font-bold text-primary">{t("formTitle")}</h1>
        <EmptyState icon="hourglass_top" title={t("pendingTitle")} description={t("pendingText")} />
      </DashboardShell>
    );
  }

  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: user.id }, select: { id: true } });
  const eligible = await eligibleMonthlyStudents(teacher.id, monthKey);
  const student = eligible.find((entry) => entry.studentId === studentId);
  if (!student) notFound();

  const existing = await prisma.monthlyReport.findFirst({
    where: { teacherId: teacher.id, studentId, monthKey },
    select: {
      achievement: true,
      learningProgress: true,
      classFocus: true,
      homeworkCompletion: true,
      punctuality: true,
      rescheduledSessions: true,
      supportAreas: true,
      nextMonthObjectives: true,
      language: true,
      submittedAt: true,
    },
  });
  const editable = !existing || isMonthlyReportEditable(existing.submittedAt);
  const rescheduledSessions = await computeRescheduledSessions(teacher.id, studentId, monthKey);

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-headline-md font-bold text-primary">{t("formTitle")}</h1>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {student.displayName} · {formatMonthLabel(monthKey, locale === "en" ? "en" : "ar")}
          </p>
        </div>
        <Link href={`/teacher/monthly-reports?month=${monthKey}`} className="btn btn-soft px-3 py-1.5 text-xs">
          {t("backToList")}
        </Link>
      </div>

      {existing && !editable ? (
        <div className="mt-5 flex flex-col gap-4">
          <p className="rounded-lg bg-surface-container-high px-4 py-3 text-body-md text-on-surface-variant">{t("lockedNotice")}</p>
          <MonthlyReportContent report={{ ...existing, monthKey }} />
        </div>
      ) : (
        <MonthlyReportForm
          studentId={studentId}
          studentName={student.displayName}
          monthKey={monthKey}
          rescheduledSessions={rescheduledSessions}
          defaultLanguage={student.reportLanguage}
          initial={existing}
        />
      )}
    </DashboardShell>
  );
}
