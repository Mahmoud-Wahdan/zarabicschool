import { getLocale, getTranslations } from "next-intl/server";

import PaymentReturnRefresher from "../../../../_components/invoices/payment-return-refresher";
import StatusBadge, { type BadgeTone } from "../../../../_components/ui/status-badge";
import { getAuthSession } from "../../../../../lib/dal";
import { formatMoney } from "../../../../../lib/payments/format";
import { getPaymentReturnView, type PaymentReturnState } from "../../../../../lib/payments/return-status";

export async function generateMetadata() {
  const t = await getTranslations("paymentReturn");
  return { title: `${t("title")} | Zarabicschool` };
}

const STATE_TONE: Record<PaymentReturnState, BadgeTone> = {
  PAID: "success",
  PROCESSING: "pending",
  DECLINED: "danger",
  FAILED: "danger",
  CANCELLED: "neutral",
};

const INVOICES_PATH: Record<string, string> = {
  ADMIN: "/admin/invoices",
  GUARDIAN: "/guardian/invoices",
  STUDENT: "/student/invoices",
};

/**
 * Paymob "transaction response callback" target (D19a, D23). DISPLAY ONLY: the
 * status comes from the database (lib/payments/return-status.ts); nothing in the
 * query string is trusted and nothing is settled here — only the signed webhook
 * settles.
 */
export default async function PaymobReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, params, t, locale] = await Promise.all([
    getAuthSession(),
    searchParams,
    getTranslations("paymentReturn"),
    getLocale(),
  ]);
  const view = await getPaymentReturnView(user, params);
  const invoicesPath = user ? INVOICES_PATH[user.role] : undefined;

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-surface p-4 md:p-6">
      <div className="w-full max-w-lg rounded-xl bg-surface-container-lowest p-8 shadow-md">
        <h1 className="text-headline-sm font-bold text-primary">{t("title")}</h1>
        {view.kind === "invoice" ? (
          <div className="mt-6 space-y-4">
            <StatusBadge tone={STATE_TONE[view.state]}>{t(`state.${view.state}`)}</StatusBadge>
            <p className="text-body-sm text-on-surface-variant">
              {t("amount")}: {formatMoney(BigInt(view.amountMinor), view.currency, locale)}
            </p>
            {view.state === "PROCESSING" ? <PaymentReturnRefresher stillProcessingText={t("stillProcessing")} /> : null}
          </div>
        ) : (
          <p className="mt-6 text-body-sm text-on-surface-variant">{t("generic")}</p>
        )}
        <div className="mt-8">
          {invoicesPath ? (
            <a href={`/${locale}${invoicesPath}`} className="font-bold text-primary underline-offset-4 hover:underline">
              {t("toInvoices")}
            </a>
          ) : user ? null : (
            <a href={`/${locale}/login`} className="font-bold text-primary underline-offset-4 hover:underline">
              {t("toLogin")}
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
