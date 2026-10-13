import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";

export default async function TeacherSessionsLoading() {
  const t = await getTranslations("sessions");

  return (
    <DashboardShell role="TEACHER" userName="">
      <div className="animate-pulse">
        <div className="h-8 w-56 rounded bg-[var(--line)]" />
        <div className="mt-3 h-4 w-72 rounded bg-[var(--line)]" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="h-20 rounded-xl bg-[var(--line)]" />
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-[var(--foreground)] opacity-60">{t("loading")}</p>
      </div>
    </DashboardShell>
  );
}
