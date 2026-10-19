import { getTranslations } from "next-intl/server";
import { getLocale } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import { requireRole, studentFinanceBlocked } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { formatSessionDateTime } from "../../../lib/schedules/display";
import { Link } from "../../../i18n/navigation";

export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: `${t("student.title")} | Zarabicschool` };
}

export default async function StudentDashboard() {
  const user = await requireRole("STUDENT");
  // Finance wall (CONTEXT §12): a student WITH a guardian sees no finance nav at all.
  const financeHidden = await studentFinanceBlocked(user.id);
  const [t, locale] = await Promise.all([getTranslations("dashboard"), getLocale()]);
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
        select: {
          attendanceStatus: true,
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
      reports: {
        // Submit-time visibility (owner, 2026-10-18 — CONTEXT §9): the student sees
        // homework from the moment the teacher SUBMITS the report — approval gates
        // pay only.
        where: { status: { in: ["SUBMITTED", "APPROVED", "ARCHIVED"] } },
        orderBy: { submittedAt: "desc" },
        take: 5,
        select: { id: true, homework: true, submittedAt: true, session: { select: { scheduledStart: true, subject: { select: { nameAr: true, nameEn: true } } } } },
      },
    },
  });

  const remaining = student?.subscriptions.reduce((total, subscription) => {
    return total + subscription.ledgerEntries.reduce((sum, entry) => sum + entry.sessionsDelta, 0);
  }, 0);
  const latestHomework = student?.reports[0];

  return (
    <DashboardShell role={user.role} userName={user.displayName} hideNavKeys={financeHidden ? ["invoices"] : undefined}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("student.title")}</h1>
      <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
        {t("student.welcome", { name: user.displayName })}
      </p>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--line)] bg-white p-5">
          <h2 className="font-semibold text-[var(--navy)]">{t("student.sections.upcoming")}</h2>
          <p className="mt-2 text-2xl font-bold">{student?.sessionStudents.length ?? 0}</p>
          <p className="mt-1 text-xs opacity-70">
            {t("guardian.metrics.remaining")}: {remaining ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-white p-5">
          <h2 className="font-semibold text-[var(--navy)]">{t("student.sections.past")}</h2>
          <p className="mt-2 text-sm opacity-70">{t("student.metrics.attendanceFromReports")}</p>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-white p-5">
          <h2 className="font-semibold text-[var(--navy)]">{t("student.sections.homework")}</h2>
          {latestHomework ? (
            <p className="mt-2 line-clamp-3 text-sm opacity-80">{latestHomework.homework}</p>
          ) : (
            <p className="mt-2 text-sm opacity-70">{t("student.metrics.notAvailable")}</p>
          )}
        </div>
      </section>
      <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("student.sections.upcoming")}</h2>
        <div className="mt-4 space-y-3">
          {student?.sessionStudents.length ? (
            student.sessionStudents.map((item) => (
              <div key={item.session.id} className="flex justify-between gap-3 rounded-lg bg-[var(--background)] p-3 text-sm">
                <span>{locale === "ar" ? item.session.subject.nameAr : item.session.subject.nameEn}</span>
                <span>{formatSessionDateTime(item.session.scheduledStart, user.timezone, locale)}</span>
                <Link href={`/student/sessions/${item.session.id}/report`} className="cta-primary rounded-lg px-3 py-2 text-xs">
                  {t("student.actions.session")}
                </Link>
              </div>
            ))
          ) : (
            <p className="text-sm opacity-70">{t("student.metrics.attendanceFromReports")}</p>
          )}
        </div>
      </section>
      <Link href="/student/sessions" className="cta-secondary mt-5 rounded-xl px-4 py-2 text-sm">{t("student.actions.schedule")}</Link>
    </DashboardShell>
  );
}
