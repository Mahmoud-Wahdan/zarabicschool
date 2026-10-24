import { getLocale, getTranslations } from "next-intl/server";

import { prisma } from "../../../../lib/prisma";
import { requireRole } from "../../../../lib/dal";
import { isPhase6bReady } from "../../../../lib/billing/readiness";
import { getPayPerSessionConfig } from "../../../../lib/billing/pay-per-session";
import DashboardShell from "../../../_components/dashboard-shell";
import EmptyState from "../../../_components/ui/empty-state";
import PageHeader from "../../../_components/ui/page-header";
import AdminBillingPanel, { type BillingPlanRow } from "../../../_components/billing/admin-billing-panel";

export async function generateMetadata() {
  const t = await getTranslations("billingAdmin");
  return { title: `${t("title")} | Zarabicschool` };
}

/**
 * Admin billing management (Phase 6b — B7): plans, exchange rates, and the
 * pay-per-session limits, on the existing Admin billing APIs. Supervisor is
 * redirected by requireRole — money surfaces are Admin-only (CONTEXT §4).
 * Plans and rates need migration 20261020000000 (the page degrades with the
 * exact migration name instead of crashing); pay-per-session settings work on
 * the existing AcademySettings table. Nothing here implies a configured payment
 * provider — USD checkout stays disabled until the owner resolves Dodo vs Xpay.
 */
export default async function AdminBillingPage() {
  const user = await requireRole("ADMIN");
  const locale = await getLocale();
  const t = await getTranslations("billingAdmin");

  const migrationPending = !(await isPhase6bReady());
  const [plans, rates, payPerSession] = await Promise.all([
    migrationPending
      ? Promise.resolve([])
      : prisma.billingPlan.findMany({
          where: { academyId: user.academyId },
          orderBy: [{ packageType: "asc" }, { sessionsPerMonth: "asc" }],
          include: { _count: { select: { subscriptions: true } } },
        }),
    migrationPending
      ? Promise.resolve([])
      : prisma.exchangeRate.findMany({
          where: { academyId: user.academyId },
          orderBy: { effectiveFrom: "desc" },
          include: { createdBy: { select: { displayName: true } } },
          take: 50,
        }),
    getPayPerSessionConfig(user.academyId),
  ]);

  const planRows: BillingPlanRow[] = plans.map((plan) => ({
    id: plan.id,
    nameAr: plan.nameAr,
    nameEn: plan.nameEn,
    packageType: plan.packageType === "ANNUAL_PLAN" ? "ANNUAL_PLAN" : "MONTHLY_PLAN",
    sessionsPerMonth: plan.sessionsPerMonth,
    basePriceMinor: plan.basePriceMinor.toString(),
    currency: plan.currency,
    tier: plan.tier,
    isActive: plan.isActive,
    activeSubscribersCount: plan._count.subscriptions,
  }));

  const dateFormatter = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <PageHeader
        eyebrow={t("eyebrow")}
        eyebrowMeta={t("eyebrowMeta")}
        title={t("title")}
        subtitle={t("subtitle")}
      />

      {migrationPending && (
        <div className="z-card flex flex-col gap-1 rounded-xl border border-outline-variant p-4" role="status">
          <h2 className="text-title-md font-bold text-primary">{t("migrationPendingTitle")}</h2>
          <p className="text-body-sm text-on-surface-variant">{t("migrationPendingText")}</p>
        </div>
      )}

      <AdminBillingPanel plans={planRows} migrationPending={migrationPending} payPerSession={payPerSession} />

      <section className="z-card flex flex-col gap-4 rounded-xl p-4 sm:p-6">
        <h2 className="text-headline-sm font-bold text-primary">{t("ratesTitle")}</h2>
        <p className="text-body-sm text-on-surface-variant">{t("ratesHint")}</p>
        {rates.length === 0 ? (
          <EmptyState icon="currency_exchange" title={t("emptyRates")} description={t("emptyRatesText")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="z-table min-w-[640px]">
              <thead>
                <tr>
                  <th scope="col">{t("colFrom")}</th>
                  <th scope="col">{t("colTo")}</th>
                  <th scope="col">{t("colRate")}</th>
                  <th scope="col">{t("colEffective")}</th>
                  <th scope="col">{t("colSetBy")}</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate.id}>
                    <td className="font-semibold">{rate.fromCurrency}</td>
                    <td>{rate.toCurrency}</td>
                    <td className="font-semibold">{rate.rate.toString()}</td>
                    <td className="text-on-surface-variant">{dateFormatter.format(rate.effectiveFrom)}</td>
                    <td className="text-on-surface-variant">{rate.createdBy.displayName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
