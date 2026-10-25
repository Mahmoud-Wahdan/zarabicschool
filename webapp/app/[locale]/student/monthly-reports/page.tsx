import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import MonthlyReportContent from "../../../_components/monthly/monthly-report-content";
import EmptyState from "../../../_components/ui/empty-state";
import { requireRole, studentFinanceBlocked } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { formatMonthLabel } from "../../../../lib/reports/month-key";
import { getMonthlyReportForViewer } from "../../../../lib/reports/monthly";

export async function generateMetadata() {
  const t = await getTranslations("studentMonthly");
  return { title: `${t("title")} | Zarabicschool` };
}

/**
 * Student monthly reports (Session 1 — CONTEXT §9): a student WITH a guardian sees
 * ONLY "key learning objectives for next month" (PROPOSAL); an adult student
 * without a guardian sees the whole report. Content renders in the report's
 * language; chrome stays in the UI locale.
 */
export default async function StudentMonthlyReportsPage() {
  const user = await requireRole("STUDENT");
  const financeHidden = await studentFinanceBlocked(user.id);
  const locale = await getLocale();
  const t = await getTranslations("studentMonthly");

  const student = await prisma.student.findUnique({
    where: { userId: user.id },
    select: { id: true, guardianId: true },
  });
  if (!student) {
    return (
      <DashboardShell role={user.role} userName={user.displayName} hideNavKeys={financeHidden ? ["invoices"] : undefined}>
        <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
        <EmptyState icon="person_off" title={t("noProfile")} />
      </DashboardShell>
    );
  }

  const rows = await prisma.monthlyReport.findMany({
    where: { studentId: student.id, academyId: user.academyId },
    orderBy: { monthKey: "desc" },
    take: 24,
    select: { monthKey: true },
  });
  const views = (
    await Promise.all(
      rows.map(async (row) => ({
        monthKey: row.monthKey,
        view: await getMonthlyReportForViewer(
          { userId: user.id, academyId: user.academyId, role: user.role },
          student.id,
          row.monthKey,
        ),
      })),
    )
  ).filter((entry): entry is { monthKey: string; view: NonNullable<Awaited<ReturnType<typeof getMonthlyReportForViewer>>> } =>
    Boolean(entry.view),
  );

  return (
    <DashboardShell role={user.role} userName={user.displayName} hideNavKeys={financeHidden ? ["invoices"] : undefined}>
      <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">{t("subtitle")}</p>
      {views.length === 0 ? (
        <EmptyState icon="calendar_month" title={t("emptyTitle")} description={t("emptyText")} />
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {views.map(({ monthKey, view }) => (
            <section key={view.id} className="flex flex-col gap-3">
              <h2 className="text-title-md font-bold text-primary">{formatMonthLabel(monthKey, locale === "en" ? "en" : "ar")}</h2>
              <MonthlyReportContent report={{ ...view, monthKey }} />
            </section>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
