import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import PageHeader from "../../../_components/ui/page-header";
import ProfilesPanel from "../profiles-panel";
import { requireRoles } from "../../../../lib/dal";

export async function generateMetadata() {
  const t = await getTranslations("management");
  return { title: `${t("guardians.title")} | Zarabicschool` };
}

export default async function GuardiansPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const t = await getTranslations("management");
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <PageHeader title={t("guardians.title")} subtitle={t("guardians.subtitle")} />
      <ProfilesPanel type="guardian" title={t("guardians.title")} canSetAnnouncements={user.role === "ADMIN"} />
    </DashboardShell>
  );
}
