import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import PageHeader from "../../_components/ui/page-header";
import { requireRole } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { formatSessionDateTime } from "../../../lib/schedules/display";
import { Link } from "../../../i18n/navigation";

import AnnouncementsWidget from "../../_components/announcements/announcements-widget";
import EvaluationPromptCard from "../../_components/evaluations/evaluation-prompt-card";
export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: `${t("guardian.title")} | Zarabicschool` };
}

export default async function GuardianDashboard() {
  const user = await requireRole("GUARDIAN");
  const [t, tShell, locale] = await Promise.all([getTranslations("dashboard"), getTranslations("appShell"), getLocale()]);
  const guardian = await prisma.guardian.findUnique({
    where: { userId: user.id },
    select: {
      students: {
        select: {
          user: { select: { displayName: true, isActive: true } },
          subscriptions: {
            where: { status: "ACTIVE" },
            select: {
              sessionsPurchased: true,
              ledgerEntries: { select: { sessionsDelta: true } },
            },
          },
          sessionStudents: {
            where: { session: { scheduledStart: { gte: new Date() } } },
            orderBy: { session: { scheduledStart: "asc" } },
            take: 3,
            select: {
              session: {
                select: {
                  id: true,
                  scheduledStart: true,
                  timezone: true,
                  subject: { select: { nameAr: true, nameEn: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <AnnouncementsWidget academyId={user.academyId} timeZone={user.timezone || "Africa/Cairo"} />
      <EvaluationPromptCard userId={user.id} academyId={user.academyId} role="GUARDIAN" />
      <PageHeader title={t("guardian.title")} subtitle={t("guardian.welcome", { name: user.displayName })} />

      <section className="mt-6 rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
        <h2 className="font-semibold text-primary">{t("guardian.sections.schedule")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {guardian?.students.length ? (
            guardian.students.map((student) => (
              <div key={student.user.displayName} className="rounded-lg bg-surface p-4">
                <h3 className="font-semibold">{student.user.displayName}</h3>
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  {student.sessionStudents.length} {t("guardian.metrics.upcoming")}
                </p>
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  {student.subscriptions.reduce(
                    (sum, item) => sum + item.ledgerEntries.reduce((total, entry) => total + entry.sessionsDelta, 0),
                    0,
                  )} {t("guardian.metrics.remaining")}
                </p>
                {student.sessionStudents.length ? (
                  <ul className="mt-2 space-y-1 text-label-sm text-on-surface-variant">
                    {student.sessionStudents.map((item) => (
                      <li key={item.session.id}>
                        {locale === "ar" ? item.session.subject.nameAr : item.session.subject.nameEn}
                        {" · "}
                        {formatSessionDateTime(item.session.scheduledStart, user.timezone, locale)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-body-sm text-on-surface-variant">{t("guardian.metrics.remainingFromSubscriptions")}</p>
          )}
        </div>
      </section>
      <Link href="/guardian/sessions" className="cta-secondary mt-5 rounded-xl px-4 py-2 text-sm">{t("guardian.actions.schedule")}</Link>
      <section className="mt-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
        <h2 className="font-semibold text-primary">{t("guardian.sections.reports")}</h2>
        <p className="mt-2 text-body-sm text-on-surface-variant">{t("guardian.metrics.reportsUnavailable")}</p>
        <Link href="/guardian/reports" className="btn btn-primary mt-3 inline-block rounded-lg px-3 py-2 text-xs">
          {t("guardian.actions.reports")}
        </Link>
      </section>
      <section className="mt-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
        <h2 className="font-semibold text-primary">{t("guardian.sections.finance")}</h2>
        <p className="mt-2 text-body-sm text-on-surface-variant">{t("guardian.metrics.remainingFromSubscriptions")}</p>
        <Link href="/guardian/invoices" className="btn btn-primary mt-3 inline-block rounded-lg px-3 py-2 text-xs">
          {tShell("nav.invoices")}
        </Link>
      </section>
    </DashboardShell>
  );
}
