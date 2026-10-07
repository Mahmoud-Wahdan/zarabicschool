import DashboardShell from "../../../_components/dashboard-shell";
import ProfilesPanel from "../profiles-panel";
import { requireRoles } from "../../../../lib/dal";
export default async function GuardiansPage() { const user = await requireRoles(["ADMIN", "SUPERVISOR"]); return <DashboardShell role={user.role} userName={user.displayName}><h1 className="text-xl font-bold text-[var(--navy)]">Guardians</h1><ProfilesPanel type="guardian" title="Guardians" /></DashboardShell>; }
