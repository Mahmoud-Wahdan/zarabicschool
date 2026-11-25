import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import PageHeader from "../../../_components/ui/page-header";
import { requireRoles } from "../../../../lib/dal";
import { listDirectoryUsers } from "../../../../lib/users/directory";
import PrivilegedUsersPanel from "./privileged-users-panel";

export default async function UserSettingsPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const t = await getTranslations("privilegedUsers");
  const rows = await listDirectoryUsers(user);
  const users = rows.map(({ dateOfBirth, ...account }) => ({
    ...account,
    dateOfBirth: dateOfBirth?.toISOString().slice(0, 10) ?? null,
  }));

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <PrivilegedUsersPanel initialUsers={users} currentUserId={user.id} isAdmin={user.role === "ADMIN"} />
    </DashboardShell>
  );
}
