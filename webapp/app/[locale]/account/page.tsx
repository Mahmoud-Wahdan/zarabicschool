import { getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import { requireRoles } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import TimeZoneForm from "./time-zone-form";

export async function generateMetadata() {
  const t = await getTranslations("account");
  return { title: `${t("title")} | Zarabicschool` };
}

/** Every signed-in role: their own account settings (S-03 time zone). */
export default async function AccountPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  const t = await getTranslations("account");
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { timezone: true, timezoneSource: true } });
  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={stored.timezone}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("title")}</h1>
      <p className="mt-2 max-w-prose text-sm opacity-70">{t("subtitle")}</p>
      <section className="mt-6 rounded-xl border border-[var(--line)] bg-white p-5 sm:p-6">
        <TimeZoneForm current={stored.timezone} source={stored.timezoneSource} />
      </section>
    </DashboardShell>
  );
}
