import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
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
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("teachers.title")}</h1>
      <p className="mt-2 text-sm opacity-70">{t("teachers.subtitle")}</p>
      <ProfilesPanel type="teacher" title={t("teachers.title")} />
    </DashboardShell>
  );
}
