import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
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
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("guardians.title")}</h1>
      <p className="mt-2 text-sm opacity-70">{t("guardians.subtitle")}</p>
      <ProfilesPanel type="guardian" title={t("guardians.title")} />
    </DashboardShell>
  );
}
