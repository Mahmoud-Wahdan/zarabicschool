import { getLocale, getTranslations } from "next-intl/server";

import AutoRenewPanel from "../../../_components/billing/auto-renew-panel";
import GraceDaysSetting from "../../../_components/billing/grace-days-setting";
import DashboardShell from "../../../_components/dashboard-shell";
import { requireRole } from "../../../../lib/dal";
import { loadRenewalRows } from "../../../../lib/billing/renewal-view";
import { getRenewalGraceDays } from "../../../../lib/config/renewal-grace";
import { prisma } from "../../../../lib/prisma";

export async function generateMetadata() {
  const t = await getTranslations("renewal");
  return { title: `${t("adminTitle")} | Zarabicschool` };
}

/**
 * Admin: every automatic renewal in the academy (D52, D58). The Admin may cancel
 * (Paymob first, the paid period stays) but never signs up for a payer — consent is
 * the payer's own (D57). Supervisor never sees money.
 */
export default async function AdminRenewalsPage() {
  const user = await requireRole("ADMIN");
  const [t, locale] = await Promise.all([getTranslations("renewal"), getLocale()]);
  const [renewals, graceDays] = await Promise.all([loadRenewalRows(user, locale), getRenewalGraceDays(prisma, user.academyId)]);
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("adminTitle")}</h1>
      <p className="mt-2 max-w-prose text-sm opacity-70">{t("adminSubtitle")}</p>
      <div className="mt-6">
        <GraceDaysSetting initialDays={graceDays} />
      </div>
      <div className="mt-6">
        <AutoRenewPanel mode="admin" students={[]} plans={[]} subscriptions={renewals} timeZone={user.timezone} now={new Date().toISOString()} />
      </div>
    </DashboardShell>
  );
}
