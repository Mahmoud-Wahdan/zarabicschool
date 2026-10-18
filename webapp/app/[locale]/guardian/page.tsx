import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import { requireRole } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { formatSessionDateTime } from "../../../lib/schedules/display";
import { Link } from "../../../i18n/navigation";

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
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("guardian.title")}</h1>
      <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
        {t("guardian.welcome", { name: user.displayName })}
      </p>

      <section className="mt-6 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("guardian.sections.schedule")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {guardian?.students.length ? (
            guardian.students.map((student) => (
              <div key={student.user.displayName} className="rounded-lg bg-[var(--background)] p-4">
                <h3 className="font-semibold">{student.user.displayName}</h3>
                <p className="mt-1 text-sm opacity-70">
                  {student.sessionStudents.length} {t("guardian.metrics.upcoming")}
                </p>
                <p className="mt-1 text-sm opacity-70">
                  {student.subscriptions.reduce(
                    (sum, item) => sum + item.ledgerEntries.reduce((total, entry) => total + entry.sessionsDelta, 0),
                    0,
                  )} {t("guardian.metrics.remaining")}
                </p>
                {student.sessionStudents.length ? (
                  <ul className="mt-2 space-y-1 text-xs opacity-80">
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
            <p className="text-sm opacity-70">{t("guardian.metrics.remainingFromSubscriptions")}</p>
          )}
        </div>
      </section>
      <Link href="/guardian/sessions" className="cta-secondary mt-5 rounded-xl px-4 py-2 text-sm">{t("guardian.actions.schedule")}</Link>
      <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("guardian.sections.reports")}</h2>
        <p className="mt-2 text-sm opacity-70">{t("guardian.metrics.reportsUnavailable")}</p>
        <Link href="/guardian/reports" className="cta-primary mt-3 inline-block rounded-lg px-3 py-2 text-xs">
          {t("guardian.actions.reports")}
        </Link>
      </section>
      <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("guardian.sections.finance")}</h2>
        <p className="mt-2 text-sm opacity-70">{t("guardian.metrics.remainingFromSubscriptions")}</p>
        <Link href="/guardian/invoices" className="cta-primary mt-3 inline-block rounded-lg px-3 py-2 text-xs">
          {tShell("nav.invoices")}
        </Link>
      </section>
    </DashboardShell>
  );
}
