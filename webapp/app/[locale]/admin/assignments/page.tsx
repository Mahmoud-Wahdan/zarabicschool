import DashboardShell from "../../../_components/dashboard-shell";
import { requireRoles } from "../../../../lib/dal";
import AssignmentsPanel from "./assignments-panel";

export default async function AssignmentsPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">Teacher–Subject assignments</h1>
      <p className="mt-2 text-sm opacity-70">Confirm which teachers may teach each subject.</p>
      <AssignmentsPanel />
    </DashboardShell>
  );
}
