import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import Icon from "../../../_components/ui/icon";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { getReportForViewer } from "../../../../lib/reports/visibility";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("guardianReports");
  return { title: `${t("title")} | Zarabicschool` };
}

/**
 * Guardian reports view (Batch D): approved reports of all linked children, read
 * through the role-shaped visibility data layer (guardians see the full report).
 */
export default async function GuardianReportsPage() {
  const user = await requireRole("GUARDIAN");
  const locale = await getLocale();
  const t = await getTranslations("guardianReports");
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
      return { child, reports };
    }),
  );

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-8 text-white sm:px-10">
        <Icon name="menu_book" size={32} className="text-[var(--gold)]" />
        <h1 className="mt-3 text-3xl font-bold">{t("title")}</h1>
        <p className="mt-2 text-sm text-white/80">{t("subtitle")}</p>
      </section>
      {sections.map(({ child, reports }) => (
        <section key={child.id} className="mt-6 space-y-3">
          <h2 className="text-lg font-bold text-[var(--navy)]">{child.user.displayName}</h2>
          {reports.map(({ session, view }) => (
            <article key={`${child.id}:${view.id}`} className="dashboard-card space-y-2 p-5">
              <div className="flex flex-wrap justify-between gap-2">
                <strong className="text-[var(--navy)]">{subjectName(session.subject)}</strong>
                <span className="text-sm opacity-70">{formatSessionDateTime(session.scheduledStart, user.timezone, locale)}</span>
              </div>
              {view.classRemark ? <p className="text-sm"><strong>{t("remark")}:</strong> {view.classRemark}</p> : null}
              <p className="text-sm"><strong>{t("summary")}:</strong> {view.summary}</p>
              <p className="text-sm"><strong>{t("homework")}:</strong> {view.homework}</p>
              {view.notes ? <p className="text-sm"><strong>{t("notes")}:</strong> {view.notes}</p> : null}
              {view.attachments.length > 0 ? (
                <p className="text-label-sm opacity-70">{t("attachmentsCount", { count: view.attachments.length })}</p>
              ) : null}
            </article>
          ))}
          {!reports.length ? <p className="dashboard-card p-5 text-sm opacity-70">{t("empty", { name: child.user.displayName })}</p> : null}
        </section>
      ))}
      {!children.length ? <p className="dashboard-card mt-6 p-5 text-sm opacity-70">{t("noChildren")}</p> : null}
    </DashboardShell>
  );
}
