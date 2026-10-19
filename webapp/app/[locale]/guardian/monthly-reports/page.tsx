import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import MonthlyReportContent from "../../../_components/monthly/monthly-report-content";
import EmptyState from "../../../_components/ui/empty-state";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { formatMonthLabel } from "../../../../lib/reports/month-key";
import { getMonthlyReportForViewer } from "../../../../lib/reports/monthly";

export async function generateMetadata() {
  const t = await getTranslations("guardianMonthly");
  return { title: `${t("title")} | Zarabicschool` };
}

/**
 * Guardian monthly reports view (Session 1 — CONTEXT §9): the guardian sees the
 * whole monthly report for each linked child. Content renders in the report's
 * language; chrome stays in the UI locale.
 */
export default async function GuardianMonthlyReportsPage() {
  const user = await requireRole("GUARDIAN");
  const locale = await getLocale();
  const t = await getTranslations("guardianMonthly");

  const guardian = await prisma.guardian.findFirst({
    where: { userId: user.id, academyId: user.academyId },
    select: { id: true },
  });

  const children = guardian
    ? await prisma.student.findMany({
        where: { academyId: user.academyId, guardianId: guardian.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, user: { select: { displayName: true } } },
      })
    : [];

  const childrenReports = await Promise.all(
    children.map(async (child) => {
      const rows = await prisma.monthlyReport.findMany({
        where: { studentId: child.id, academyId: user.academyId },
        orderBy: { monthKey: "desc" },
        take: 24,
        select: { monthKey: true },
      });

      const views = (
        await Promise.all(
          rows.map(async (row) => ({
            monthKey: row.monthKey,
            view: await getMonthlyReportForViewer(
              { userId: user.id, academyId: user.academyId, role: "GUARDIAN" },
              child.id,
              row.monthKey,
            ),
          })),
        )
      ).filter((entry): entry is { monthKey: string; view: NonNullable<Awaited<ReturnType<typeof getMonthlyReportForViewer>>> } =>
        Boolean(entry.view),
      );

      return { child, views };
    }),
  );

  const hasReports = childrenReports.some((c) => c.views.length > 0);

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">{t("subtitle")}</p>

      {children.length === 0 ? (
        <EmptyState icon="person_off" title={t("noChildren")} />
      ) : !hasReports ? (
        <EmptyState icon="calendar_month" title={t("emptyTitle")} description={t("emptyText")} />
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {childrenReports.map(({ child, views }) => (
            <section key={child.id} className="flex flex-col gap-4">
              <div className="flex items-center gap-2 border-b border-outline-variant pb-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-container text-sm font-bold text-on-primary">
                  {child.user.displayName.trim().slice(0, 1).toUpperCase() || "?"}
                </span>
                <h2 className="text-title-md font-bold text-primary">{child.user.displayName}</h2>
              </div>

              {views.length === 0 ? (
                <p className="rounded-lg bg-surface-container-low px-3 py-2 text-body-sm text-on-surface-variant">
                  {t("noChildReports")}
                </p>
              ) : (
                <div className="flex flex-col gap-5">
                  {views.map(({ monthKey, view }) => (
                    <article key={view.id} className="flex flex-col gap-2">
                      <h3 className="text-body-md font-semibold text-primary">
                        {formatMonthLabel(monthKey, locale === "en" ? "en" : "ar")}
                      </h3>
                      <MonthlyReportContent report={{ ...view, monthKey }} />
                    </article>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
