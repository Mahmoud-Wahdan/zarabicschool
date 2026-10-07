import { CalendarDays, ClipboardCheck, GraduationCap, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import { requireRole } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { Link } from "../../../i18n/navigation";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "supervisor" });
  return { title: `${t("title")} | Zarabicschool` };
}

export default async function SupervisorDashboard() {
  const user = await requireRole("SUPERVISOR");
  const t = await getTranslations("supervisor");
  const [profileCounts, sessionCount, pendingReports, activeSessions] = await Promise.all([
    Promise.all([
      prisma.student.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
      prisma.guardian.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
      prisma.teacher.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
      prisma.subject.count({ where: { academyId: user.academyId, isActive: true } }),
    ]),
    prisma.session.count({ where: { academyId: user.academyId } }),
    prisma.report.count({ where: { academyId: user.academyId, status: "SUBMITTED" } }),
    prisma.session.count({ where: { academyId: user.academyId, status: "SCHEDULED" } }),
  ]);
  const [students, guardians, teachers, subjects] = profileCounts;

  const metrics = [
    { label: t("profiles.students"), value: students, icon: GraduationCap, tone: "dashboard-metric--emerald" },
    { label: t("profiles.guardians"), value: guardians, icon: Users, tone: "dashboard-metric--info" },
    { label: t("profiles.teachers"), value: teachers, icon: Users, tone: "dashboard-metric--gold" },
    { label: t("profiles.subjects"), value: subjects, icon: ClipboardCheck, tone: "dashboard-metric--navy" },
  ];

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-10 text-white shadow-[var(--dashboard-shadow)] sm:px-10">
        <div className="absolute -end-10 -top-20 h-56 w-56 rounded-full border-[24px] border-[var(--gold)]/20" aria-hidden />
        <p className="relative text-sm font-semibold text-[var(--gold)]">{t("eyebrow")}</p>
        <h1 className="relative mt-3 text-3xl font-bold sm:text-4xl">{t("title")}</h1>
        <p className="relative mt-3 max-w-2xl text-sm leading-7 text-white/80">{t("subtitle")}</p>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon, tone }) => (
          <article key={label} className={`lift-card dashboard-metric ${tone} rounded-2xl border border-[var(--line)]`}>
            <Icon aria-hidden className="h-6 w-6 text-[var(--navy)]" />
            <p className="mt-4 text-xs opacity-70">{label}</p>
            <p className="mt-1 text-3xl font-bold text-[var(--navy)]">{value}</p>
          </article>
        ))}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/admin/enrollments" className="lift-card dashboard-card flex items-center gap-4 p-5">
          <CalendarDays className="h-8 w-8 text-[var(--emerald)]" aria-hidden />
          <span><strong className="block text-[var(--navy)]">{t("operations.sessions")}</strong><span className="mt-1 block text-sm opacity-70">{activeSessions} {t("operations.activeSessions")} · {sessionCount} {t("operations.totalSessions")}</span></span>
        </Link>
        <Link href="/admin/assignments" className="lift-card dashboard-card flex items-center gap-4 p-5">
          <ClipboardCheck className="h-8 w-8 text-[var(--gold)]" aria-hidden />
          <span><strong className="block text-[var(--navy)]">{t("operations.reports")}</strong><span className="mt-1 block text-sm opacity-70">{pendingReports} {t("operations.pendingReports")}</span></span>
        </Link>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["/admin/students", t("actions.students"), t("actions.studentsDescription")],
          ["/admin/teachers", t("actions.teachers"), t("actions.teachersDescription")],
          ["/admin/subjects", t("actions.subjects"), t("actions.subjectsDescription")],
          ["/admin/enrollments", t("actions.enrollments"), t("actions.enrollmentsDescription")],
        ].map(([href, title, description]) => (
          <Link key={href} href={href} className="lift-card dashboard-card p-5">
            <h2 className="font-bold text-[var(--navy)]">{title}</h2>
            <p className="mt-2 text-sm leading-6 opacity-70">{description}</p>
          </Link>
        ))}
      </section>
      <p className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 text-xs opacity-60">{t("restricted")}</p>
    </DashboardShell>
  );
}
