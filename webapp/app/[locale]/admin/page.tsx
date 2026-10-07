import { getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import { requireRole } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { Link } from "../../../i18n/navigation";

export const metadata = { title: "لوحة الإدارة | Zarabicschool" };

export default async function AdminDashboard() {
  const user = await requireRole("ADMIN");
  const t = await getTranslations("dashboard");
  const [applications, students, guardians, teachers, subjects] = await Promise.all([
    prisma.application.count({ where: { academyId: user.academyId, status: { in: ["NEW", "REVIEWED"] } } }),
    prisma.student.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
    prisma.guardian.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
    prisma.teacher.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
    prisma.subject.count({ where: { academyId: user.academyId, isActive: true } }),
  ]);

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("admin.title")}</h1>
      <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
        {t("admin.welcome", { name: user.displayName })}
      </p>

      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          [t("admin.metrics.students"), students, "dashboard-metric--emerald"],
          [t("admin.metrics.guardians"), guardians, "dashboard-metric--info"],
          [t("admin.metrics.teachers"), teachers, "dashboard-metric--gold"],
          [t("admin.metrics.subjects"), subjects, "dashboard-metric--navy"],
          [t("admin.sections.openApplications"), applications, "dashboard-metric--gold"],
        ].map(([label, value, tone]) => (
          <div key={label} className={`dashboard-metric ${tone}`}>
            <p className="text-xs opacity-70">{label}</p>
            <p className="mt-2 text-2xl font-bold text-[var(--navy)]">{value}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/admin/applications"
          className="dashboard-card p-5 transition hover:border-[var(--emerald)] hover:shadow-sm"
        >
          <h2 className="font-semibold text-[var(--navy)]">{t("admin.sections.applications")}</h2>
          <p className="mt-2 text-sm text-[var(--emerald)]">
            {applications} {t("admin.sections.openApplications")}
          </p>
        </Link>
        <Link href="/admin/users" className="dashboard-card p-5 transition hover:border-[var(--emerald)] hover:shadow-sm">
          <h2 className="font-semibold text-[var(--navy)]">SuperAdmin accounts</h2>
          <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">Manage Admin and Supervisor access</p>
        </Link>
        <Link href="/admin/students" className="dashboard-card p-5 transition hover:border-[var(--emerald)] hover:shadow-sm">
          <h2 className="font-semibold text-[var(--navy)]">{t("admin.sections.accounts")}</h2>
          <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
            {students} {t("admin.metrics.students")} · {guardians} {t("admin.metrics.guardians")} · {teachers} {t("admin.metrics.teachers")}
          </p>
        </Link>
        <Link href="/admin/subjects" className="dashboard-card p-5 transition hover:border-[var(--emerald)] hover:shadow-sm">
          <h2 className="font-semibold text-[var(--navy)]">{t("admin.sections.schedules")}</h2>
          <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
            {subjects} {t("admin.metrics.subjects")}
          </p>
        </Link>
        <Link href="/admin/assignments" className="dashboard-card p-5 transition hover:border-[var(--emerald)] hover:shadow-sm">
          <h2 className="font-semibold text-[var(--navy)]">Teacher assignments</h2>
          <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">Confirm teacher–subject relationships</p>
        </Link>
        <Link href="/admin/enrollments" className="dashboard-card p-5 transition hover:border-[var(--emerald)] hover:shadow-sm">
          <h2 className="font-semibold text-[var(--navy)]">Session enrollments</h2>
          <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">Manage students enrolled in sessions</p>
        </Link>
        <Link href="/admin/sessions" className="dashboard-card p-5 transition hover:border-[var(--emerald)] hover:shadow-sm">
          <h2 className="font-semibold text-[var(--navy)]">Session schedule</h2>
          <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">Create, reserve, cancel, and review scheduled sessions</p>
        </Link>
      </section>
    </DashboardShell>
  );
}
