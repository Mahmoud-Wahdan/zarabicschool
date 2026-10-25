import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";

export default async function AdminApplicationsLoading() {
  const t = await getTranslations("adminApplications");

  return (
    <DashboardShell role="ADMIN" userName="">
      <div className="animate-pulse">
        <div className="h-6 w-40 rounded bg-[var(--line)]" />
        <div className="mt-3 h-4 w-72 rounded bg-[var(--line)]" />
        <div className="mt-6 h-8 w-full max-w-md rounded-full bg-[var(--line)]" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="h-16 rounded-xl bg-[var(--line)]" />
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-[var(--foreground)] opacity-60">
          {t("states.loading")}
        </p>
      </div>
    </DashboardShell>
  );
}
