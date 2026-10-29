import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import PageHeader from "../../../_components/ui/page-header";
import ProfilesPanel from "../profiles-panel";
import { requireRoles } from "../../../../lib/dal";

export async function generateMetadata() {
  const t = await getTranslations("management");
  return { title: `${t("students.title")} | Zarabicschool` };
}

export default async function StudentsPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const t = await getTranslations("management");
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <PageHeader title={t("students.title")} subtitle={t("students.subtitle")} />
      <ProfilesPanel type="student" title={t("students.title")} canSetAnnouncements={user.role === "ADMIN"} />
    </DashboardShell>
  );
}
