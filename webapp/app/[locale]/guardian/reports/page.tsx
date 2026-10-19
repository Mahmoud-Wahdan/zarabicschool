import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import Icon from "../../../_components/ui/icon";
import MonthlyReportContent from "../../../_components/monthly/monthly-report-content";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { formatMonthLabel } from "../../../../lib/reports/month-key";
import { getMonthlyReportForViewer } from "../../../../lib/reports/monthly";
import { getClassRemarkOptions } from "../../../../lib/reports/class-remarks";
import { classRemarkLabel, reportDir } from "../../../../lib/reports/report-language";
import { getReportForViewer } from "../../../../lib/reports/visibility";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("guardianReports");
  return { title: `${t("title")} | Zarabicschool` };
}

/**
 * Guardian reports view (Batch D + Session 1): submitted reports of all linked
 * children, read through the role-shaped visibility data layer (guardians see
 * the full report). Visible from SUBMISSION in every status (owner, 2026-10-18) —
 * approval gates pay only. Report CONTENT renders in the language it was written.
 * The monthly stream (CONTEXT §9) appears per child below the session reports.
 */
export default async function GuardianReportsPage() {
  const user = await requireRole("GUARDIAN");
  const locale = await getLocale();
  const t = await getTranslations("guardianReports");
  const guardian = await prisma.guardian.findFirst({
    where: { userId: user.id, academyId: user.academyId },
    select: { id: true },
  });
  const [children, classRemarkOptions] = await Promise.all([
    guardian
      ? await prisma.student.findMany({
          where: { academyId: user.academyId, guardianId: guardian.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, user: { select: { displayName: true } } },
        })
      : [],
    getClassRemarkOptions(user.academyId),
  ]);
  const subjectName = (subject: { nameEn: string; nameAr: string }) => (locale === "ar" ? subject.nameAr : subject.nameEn);

  const sections = await Promise.all(
    children.map(async (child) => {
      const roster = await prisma.sessionStudent.findMany({
        where: { studentId: child.id, session: { academyId: user.academyId } },
        select: { sessionId: true, session: { select: { scheduledStart: true, subject: { select: { nameAr: true, nameEn: true } } } } },
        orderBy: { session: { scheduledStart: "desc" as const } },
        take: 30,
      });
      const reports = (
        await Promise.all(
          roster.map(async (entry) => ({
            session: entry.session,
            view: await getReportForViewer({ userId: user.id, academyId: user.academyId, role: "GUARDIAN" }, entry.sessionId, child.id),
          })),
        )
      ).filter((entry): entry is { session: (typeof roster)[number]["session"]; view: NonNullable<Awaited<ReturnType<typeof getReportForViewer>>> } =>
        Boolean(entry.view));

      // Monthly stream (Session 1): the guardian sees the whole monthly report
      // (read through the visibility layer), rendered in its own language.
      const monthlyKeys = await prisma.monthlyReport.findMany({
        where: { studentId: child.id, academyId: user.academyId },
        orderBy: { monthKey: "desc" },
        take: 6,
        select: { monthKey: true },
      });
      const monthly = (
        await Promise.all(
          monthlyKeys.map(async (row) => ({
            monthKey: row.monthKey,
            view: await getMonthlyReportForViewer(
              { userId: user.id, academyId: user.academyId, role: "GUARDIAN" },
              child.id,
              row.monthKey,
            ),
          })),
        )
      ).filter((entry): entry is { monthKey: string; view: NonNullable<Awaited<ReturnType<typeof getMonthlyReportForViewer>>> } =>
        Boolean(entry.view));

      return { child, reports, monthly };
    }),
  );

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-8 text-white sm:px-10">
        <Icon name="menu_book" size={32} className="text-[var(--gold)]" />
        <h1 className="mt-3 text-3xl font-bold">{t("title")}</h1>
        <p className="mt-2 text-sm text-white/80">{t("subtitle")}</p>
      </section>
      {sections.map(({ child, reports,monthly }) => (
        <section key={child.id} className="mt-6 space-y-3">
          <h2 className="text-lg font-bold text-[var(--navy)]">{child.user.displayName}</h2>
          {reports.map(({ session, view }) => (
            <article
              key={`${child.id}:${view.id}`}
              className="dashboard-card space-y-2 p-5"
              dir={view.language ? reportDir(view.language) : undefined}
              lang={view.language ?? undefined}
            >
              <div className="flex flex-wrap justify-between gap-2">
                <strong className="text-[var(--navy)]">{subjectName(session.subject)}</strong>
                <span className="text-sm opacity-70">{formatSessionDateTime(session.scheduledStart, user.timezone, locale)}</span>
              </div>
              {view.classRemark ? (
                <p className="text-sm">
                  <strong>{t("remark")}:</strong>{" "}
                  {view.language ? classRemarkLabel(classRemarkOptions, view.classRemark, view.language) : view.classRemark}
                </p>
              ) : null}
              <p className="text-sm"><strong>{t("summary")}:</strong> {view.summary}</p>
              <p className="text-sm"><strong>{t("homework")}:</strong> {view.homework}</p>
              {view.notes ? <p className="text-sm"><strong>{t("notes")}:</strong> {view.notes}</p> : null}
              {view.attachments.length > 0 ? (
                <p className="text-label-sm opacity-70">{t("attachmentsCount", { count: view.attachments.length })}</p>
              ) : null}
            </article>
          ))}
          {!reports.length ? <p className="dashboard-card p-5 text-sm opacity-70">{t("empty", { name: child.user.displayName })}</p> : null}
          {monthly.length > 0 ? (
            <div className="mt-2 flex flex-col gap-3">
              <h3 className="text-title-md font-bold text-[var(--navy)]">{t("monthlySection")}</h3>
              {monthly.map(({ monthKey, view }) => (
                <div key={view.id} className="dashboard-card flex flex-col gap-3 p-5">
                  <strong className="text-[var(--navy)]">{formatMonthLabel(monthKey, locale === "en" ? "en" : "ar")}</strong>
                  <MonthlyReportContent report={{ ...view, monthKey }} />
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ))}
      {!children.length ? <p className="dashboard-card mt-6 p-5 text-sm opacity-70">{t("noChildren")}</p> : null}
    </DashboardShell>
  );
}
