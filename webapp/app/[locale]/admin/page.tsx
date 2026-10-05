import { getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import { requireRole } from "../../../lib/dal";
import { Link } from "../../../i18n/navigation";

export const metadata = { title: "لوحة الإدارة | Zarabicschool" };

export default async function AdminDashboard() {
  const user = await requireRole("ADMIN");
  const t = await getTranslations("dashboard");

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("admin.title")}</h1>
      <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
        {t("admin.welcome", { name: user.displayName })}
      </p>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/admin/applications"
          className="rounded-xl border border-[var(--line)] bg-white p-5 transition hover:border-[var(--emerald)] hover:shadow-sm"
        >
          <h2 className="font-semibold text-[var(--navy)]">{t("admin.sections.applications")}</h2>
          <p className="mt-2 text-sm text-[var(--emerald)]">
            {t("admin.sections.openApplications")}
          </p>
        </Link>
        {[
          { key: "accounts", label: t("admin.sections.accounts") },
          { key: "schedules", label: t("admin.sections.schedules") },
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
