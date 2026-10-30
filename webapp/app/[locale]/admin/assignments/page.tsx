import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import PageHeader from "../../../_components/ui/page-header";
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
      <PageHeader title={t("assignments.title")} subtitle={t("assignments.intro")} />
      <div className="mt-4 flex flex-col gap-6">
        <StudentAssignmentsPanel />
        <AssignmentsPanel />
      </div>
    </DashboardShell>
  );
}
