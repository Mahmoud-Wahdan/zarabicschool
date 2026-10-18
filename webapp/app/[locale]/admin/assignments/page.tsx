import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import { requireRoles } from "../../../../lib/dal";
import AssignmentsPanel from "./assignments-panel";
import StudentAssignmentsPanel from "./student-assignments-panel";

export async function generateMetadata() {
  const t = await getTranslations("management");
  return { title: `${t("assignments.title")} | Zarabicschool` };
}

export default async function AssignmentsPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const t = await getTranslations("management");
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("assignments.title")}</h1>
      <p className="mt-2 text-sm opacity-70">{t("assignments.intro")}</p>
      <p className="mt-2 rounded-xl border border-[var(--gold)]/40 bg-[var(--gold)]/10 p-3 text-xs opacity-80">
        {t("assignments.note")}
      </p>
      <AssignmentsPanel />
      <StudentAssignmentsPanel />
    </DashboardShell>
  );
}
