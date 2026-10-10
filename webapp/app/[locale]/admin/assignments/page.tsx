import DashboardShell from "../../../_components/dashboard-shell";
import { requireRoles } from "../../../../lib/dal";
import AssignmentsPanel from "./assignments-panel";
import StudentAssignmentsPanel from "./student-assignments-panel";

export default async function AssignmentsPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">Assignments</h1>
      <p className="mt-2 text-sm opacity-70">
        Link teachers to subjects, students to subjects, and students to the teacher who teaches them. Only Admins and Supervisors manage these links; scheduling requires an ACTIVE student–teacher assignment.
      </p>
      <p className="mt-2 rounded-xl border border-[var(--gold)]/40 bg-[var(--gold)]/10 p-3 text-xs opacity-80">
        Note: a teacher–subject link cannot be removed while any student assignment history (ACTIVE or ENDED) references it — the link stays for the assignment history.
      </p>
      <AssignmentsPanel />
      <StudentAssignmentsPanel />
    </DashboardShell>
  );
}
