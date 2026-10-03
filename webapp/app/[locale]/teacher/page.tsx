import { getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import { requireRole } from "../../../lib/dal";

export const metadata = { title: "لوحة المعلمة | Zarabicschool" };

export default async function TeacherDashboard() {
  const user = await requireRole("TEACHER");
  const t = await getTranslations("dashboard");

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("teacher.title")}</h1>
      <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
        {t("teacher.welcome", { name: user.displayName })}
      </p>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { key: "today", label: t("teacher.sections.today") },
          { key: "reports", label: t("teacher.sections.reports") },
          { key: "salary", label: t("teacher.sections.salary") },
        ].map((item) => (
          <div key={item.key} className="rounded-xl border border-[var(--line)] bg-white p-5">
            <h2 className="font-semibold text-[var(--navy)]">{item.label}</h2>
            <p className="mt-2 text-sm text-[var(--foreground)] opacity-60">{t("emptyState")}</p>
          </div>
        ))}
      </section>
    </DashboardShell>
  );
}
