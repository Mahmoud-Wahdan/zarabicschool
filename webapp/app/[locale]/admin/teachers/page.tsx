import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import PageHeader from "../../../_components/ui/page-header";
import ProfilesPanel from "../profiles-panel";
import { requireRoles } from "../../../../lib/dal";

export async function generateMetadata() {
  const t = await getTranslations("management");
  return { title: `${t("teachers.title")} | Zarabicschool` };
}

export default async function TeachersPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const t = await getTranslations("management");
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <PageHeader title={t("teachers.title")} subtitle={t("teachers.subtitle")} />
      <ProfilesPanel type="teacher" title={t("teachers.title")} canSetAnnouncements={user.role === "ADMIN"} viewerRole={user.role === "ADMIN" ? "ADMIN" : "SUPERVISOR"} />
    </DashboardShell>
  );
}
