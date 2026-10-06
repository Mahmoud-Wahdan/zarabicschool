import { getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import { requireRole } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";

export const metadata = { title: "لوحة ولي الأمر | Zarabicschool" };

export default async function GuardianDashboard() {
  const user = await requireRole("GUARDIAN");
  const t = await getTranslations("dashboard");
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
            select: { session: { select: { scheduledStart: true, subject: { select: { nameAr: true, nameEn: true } } } } },
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
          {guardian?.students.map((student) => (
            <div key={student.user.displayName} className="rounded-lg bg-[var(--background)] p-4">
              <h3 className="font-semibold">{student.user.displayName}</h3>
              <p className="mt-1 text-sm opacity-70">
                {student.sessionStudents.length} {t("guardian.metrics.upcoming")}
              </p>
              <p className="mt-1 text-sm opacity-70">
                {student.subscriptions.reduce(
                  (sum, item) => sum + item.sessionsPurchased + item.ledgerEntries.reduce((total, entry) => total + entry.sessionsDelta, 0),
                  0,
                )} {t("guardian.metrics.remaining")}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("guardian.sections.reports")}</h2>
        <p className="mt-2 text-sm opacity-70">{t("guardian.metrics.reportsUnavailable")}</p>
      </section>
      <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("guardian.sections.finance")}</h2>
        <p className="mt-2 text-sm opacity-70">{t("guardian.metrics.remainingFromSubscriptions")}</p>
      </section>
    </DashboardShell>
  );
}
