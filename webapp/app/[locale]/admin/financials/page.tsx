import { getLocale, getTranslations } from "next-intl/server";

import { prisma } from "../../../../lib/prisma";
import { requireRole } from "../../../../lib/dal";
import DashboardShell from "../../../_components/dashboard-shell";
import MetricTile from "../../../_components/ui/metric-tile";
import PageHeader from "../../../_components/ui/page-header";
import EmptyState from "../../../_components/ui/empty-state";
import StatusBadge, { type BadgeTone } from "../../../_components/ui/status-badge";

export async function generateMetadata() {
  const t = await getTranslations("financialsAdmin");
  return { title: `${t("title")} | Zarabicschool` };
}

const INVOICE_STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: "pending",
  PAID: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};

const SUBSCRIPTION_STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: "success",
  EXHAUSTED: "pending",
  EXPIRED: "neutral",
  CANCELLED: "danger",
};

function formatMoney(amountMinor: bigint, currency: string, locale: string) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(Number(amountMinor) / 100);
}

export default async function AdminFinancialsPage() {
  const user = await requireRole("ADMIN");
  const locale = await getLocale();
  const t = await getTranslations("financialsAdmin");

  const [invoices, subscriptions, ledgerSums] = await Promise.all([
    prisma.invoice.findMany({
      where: { academyId: user.academyId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { student: { select: { user: { select: { displayName: true } } } } },
    }),
    prisma.subscription.findMany({
      where: { academyId: user.academyId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        student: { select: { user: { select: { displayName: true } } } },
        ledgerEntries: { select: { sessionsDelta: true } },
      },
    }),
    prisma.invoice.groupBy({
      by: ["status", "currency"],
      where: { academyId: user.academyId },
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
  ]);

  const pendingInvoices = invoices.filter((invoice) => invoice.status === "PENDING");
  const paidInvoices = invoices.filter((invoice) => invoice.status === "PAID");
  const activeSubscriptions = subscriptions.filter((subscription) => subscription.status === "ACTIVE");

  const paidSums = ledgerSums
    .filter((row) => row.status === "PAID")
    .map((row) => `${formatMoney(row._sum.amountMinor ?? BigInt(0), row.currency, locale)} (${row._count._all})`);

  const remainingBySubscription = new Map(
    subscriptions.map((subscription) => [
      subscription.id,
      subscription.ledgerEntries.reduce((total, entry) => total + entry.sessionsDelta, 0),
    ]),
  );

  const packageLabel = (type: string) =>
    type === "MONTHLY_PLAN" ? t("packageMonthly") : type === "ANNUAL_PLAN" ? t("packageAnnual") : t("packagePayPerSession");
  const providerLabel = (provider: string) => (provider === "PAYMOB" ? t("providerPaymob") : t("usdGateway"));

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <PageHeader
        eyebrow={t("eyebrow")}
        eyebrowMeta={t("eyebrowMeta")}
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label={t("metricPendingInvoices")}
          icon="hourglass_top"
          iconTone="tertiary"
          value={pendingInvoices.length}
          valueLabel={t("metricInvoicesUnit")}
          badge={{ tone: "pending", text: t("metricPendingNote") }}
        />
        <MetricTile
          label={t("metricPaidInvoices")}
          icon="verified"
          iconTone="secondary"
          value={paidInvoices.length}
          valueLabel={t("metricInvoicesUnit")}
          badge={{ tone: "success", text: t("metricPaidNote") }}
        />
        <MetricTile
          label={t("metricActiveSubscriptions")}
          icon="autorenew"
          iconTone="info"
          value={activeSubscriptions.length}
          valueLabel={t("metricSubscriptionsUnit")}
        />
        <MetricTile
          label={t("metricCollected")}
          icon="account_balance_wallet"
          iconTone="navy"
          value={paidSums.length ? paidSums.join(" • ") : t("noMoney")}
        />
      </div>

      <section className="z-card flex flex-col gap-4 rounded-xl p-4 sm:p-6">
        <h2 className="text-headline-sm font-bold text-primary">{t("invoicesTitle")}</h2>
        {invoices.length === 0 ? (
          <EmptyState icon="receipt_long" title={t("emptyInvoices")} description={t("emptyInvoicesText")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="z-table min-w-[720px]">
              <thead>
                <tr>
                  <th scope="col">{t("colStudent")}</th>
                  <th scope="col">{t("colPackage")}</th>
                  <th scope="col">{t("colSessions")}</th>
                  <th scope="col">{t("colAmount")}</th>
                  <th scope="col">{t("colProvider")}</th>
                  <th scope="col">{t("colStatus")}</th>
                  <th scope="col">{t("colDate")}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="font-semibold">{invoice.student.user.displayName}</td>
                    <td>{packageLabel(invoice.packageType)}</td>
                    <td>{invoice.sessionsPurchased}</td>
                    <td className="font-semibold">{formatMoney(invoice.amountMinor, invoice.currency, locale)}</td>
                    <td>{providerLabel(invoice.provider)}</td>
                    <td>
                      <StatusBadge tone={INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>
                        {t(`status.${invoice.status}`)}
                      </StatusBadge>
                    </td>
                    <td className="text-on-surface-variant">
                      {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      }).format(invoice.paidAt ?? invoice.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="z-card flex flex-col gap-4 rounded-xl p-4 sm:p-6">
        <h2 className="text-headline-sm font-bold text-primary">{t("subscriptionsTitle")}</h2>
        {subscriptions.length === 0 ? (
          <EmptyState icon="card_membership" title={t("emptySubscriptions")} description={t("emptySubscriptionsText")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="z-table min-w-[720px]">
              <thead>
                <tr>
                  <th scope="col">{t("colStudent")}</th>
                  <th scope="col">{t("colPackage")}</th>
                  <th scope="col">{t("colPurchased")}</th>
                  <th scope="col">{t("colRemaining")}</th>
                  <th scope="col">{t("colPeriod")}</th>
                  <th scope="col">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((subscription) => (
                  <tr key={subscription.id}>
                    <td className="font-semibold">{subscription.student.user.displayName}</td>
                    <td>{packageLabel(subscription.packageType)}</td>
                    <td>{subscription.sessionsPurchased}</td>
                    <td className="font-semibold">{remainingBySubscription.get(subscription.id) ?? 0}</td>
                    <td className="text-on-surface-variant">
                      {subscription.periodStartsAt && subscription.periodEndsAt
                        ? new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
                            day: "numeric",
                            month: "short",
                          }).formatRange(subscription.periodStartsAt, subscription.periodEndsAt)
                        : "—"}
                    </td>
                    <td>
                      <StatusBadge tone={SUBSCRIPTION_STATUS_TONE[subscription.status] ?? "neutral"}>
                        {t(`subscriptionStatus.${subscription.status}`)}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-body-sm text-on-surface-variant">{t("renewalsNote")}</p>
      </section>
    </DashboardShell>
  );
}
