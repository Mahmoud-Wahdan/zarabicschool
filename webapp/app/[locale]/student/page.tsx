import { getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import { requireRole } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";

export const metadata = { title: "لوحة الطالب | Zarabicschool" };

export default async function StudentDashboard() {
  const user = await requireRole("STUDENT");
  const t = await getTranslations("dashboard");
  const student = await prisma.student.findUnique({
    where: { userId: user.id },
    select: {
      guardian: { select: { user: { select: { displayName: true, phone: true } } } },
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
        take: 8,
        select: { attendanceStatus: true, session: { select: { scheduledStart: true, subject: { select: { nameAr: true, nameEn: true } } } } },
      },
    },
  });

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("student.title")}</h1>
      <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
        {t("student.welcome", { name: user.displayName })}
      </p>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--line)] bg-white p-5">
          <h2 className="font-semibold text-[var(--navy)]">{t("student.sections.upcoming")}</h2>
          <p className="mt-2 text-2xl font-bold">{student?.sessionStudents.length ?? 0}</p>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-white p-5">
          <h2 className="font-semibold text-[var(--navy)]">{t("student.sections.past")}</h2>
          <p className="mt-2 text-sm opacity-70">{t("student.metrics.attendanceFromReports")}</p>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-white p-5">
          <h2 className="font-semibold text-[var(--navy)]">{t("student.sections.homework")}</h2>
          <p className="mt-2 text-sm opacity-70">{t("student.metrics.notAvailable")}</p>
        </div>
      </section>
      <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("student.sections.upcoming")}</h2>
        <div className="mt-4 space-y-3">
          {student?.sessionStudents.map((item) => (
            <div key={item.session.scheduledStart.toISOString()} className="flex justify-between gap-3 rounded-lg bg-[var(--background)] p-3 text-sm">
              <span>{item.session.subject.nameEn}</span>
              <span>{item.session.scheduledStart.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>
    </DashboardShell>
  );
}
