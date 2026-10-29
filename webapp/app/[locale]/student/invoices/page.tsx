import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import DashboardShell from "../../../_components/dashboard-shell";
import AutoRenewPanel from "../../../_components/billing/auto-renew-panel";
import { loadRenewalPlans, loadRenewalRows } from "../../../../lib/billing/renewal-view";
import InvoicePaymentPanel from "../../../_components/invoices/invoice-payment-panel";
import RefundRequestButton from "../../../_components/invoices/refund-request-button";
import StatusBadge, { type BadgeTone } from "../../../_components/ui/status-badge";
import { isAutoRenewalEnabled } from "../../../../lib/config/features";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { formatMoney } from "../../../../lib/payments/format";
import { requireStudentFinanceAccess } from "../../../../lib/guards/student-finance";
import PageHeader from "../../../_components/ui/page-header";
export async function generateMetadata() {
  const t = await getTranslations("invoices");
  return { title: `${t("title")} | Zarabicschool` };
}
const INVOICE_STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: "pending",
  PAID: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};
/**
 * Adult students without a guardian pay for themselves (CONTEXT §20.6); a minor's
 * invoices belong to the guardian — the student keeps the read-only dashboard view.
 */
export default async function StudentInvoicesPage() {
  const user = await requireRole("STUDENT");
  const [t, locale] = await Promise.all([getTranslations("invoices"), getLocale()]);
  try {
 await requireStudentFinanceAccess(user.id);
} catch {
  redirect(`/${locale}/student`);
}
  const student = await prisma.student.findUnique({
    where: { userId: user.id },
    select: { id: true, guardianId: true, isAdult: true },
  });
  if (!student || student.guardianId || !student.isAdult) {
    redirect(`/${locale}/student`);
  }
  const invoices = await prisma.invoice.findMany({
    where: { academyId: user.academyId, studentId: student.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      amountMinor: true,
      currency: true,
      provider: true,
      packageType: true,
      sessionsPurchased: true,
      status: true,
      createdAt: true,
      // S-15: the latest refund request of this invoice (its state on the card).
      refundRequests: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, rejectionReason: true } },
      paidAt: true,
    },
  });
  // A6: automatic renewal stays hidden (and unloaded) until it is verified with Paymob.
  const autoRenewal = isAutoRenewalEnabled();
  const [renewals, renewalPlans] = autoRenewal ? await Promise.all([loadRenewalRows(user, locale), loadRenewalPlans(user.academyId, locale)]) : [[], []];
  const packageLabel = (type: string) =>
    type === "MONTHLY_PLAN" ? t("packageMonthly") : type === "ANNUAL_PLAN" ? t("packageAnnual") : t("packagePayPerSession");
  const providerLabel = (provider: string) => (provider === "PAYMOB" ? t("providerPaymob") : t("providerUsd"));
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {autoRenewal ? (
        <div className="mt-6">
          <AutoRenewPanel students={[{ id: student.id, name: user.displayName }]} plans={renewalPlans} subscriptions={renewals} timeZone={user.timezone} now={new Date().toISOString()} />
        </div>
      ) : null}
      <section className="mt-6 space-y-4">
        {invoices.length === 0 ? (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-6 text-body-sm text-on-surface-variant">
            <p>{t("empty")}</p>
            <p className="mt-1 text-xs">{t("emptyText")}</p>
          </div>
        ) : (
          invoices.map((invoice) => (
            <article key={invoice.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-primary">
                    {formatMoney(invoice.amountMinor, invoice.currency, locale)} · {packageLabel(invoice.packageType)} · {invoice.sessionsPurchased}
                  </p>
                  <p className="mt-1 text-label-sm text-on-surface-variant">
                    {providerLabel(invoice.provider)} ·{" "}
                    {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone: user.timezone, dateStyle: "medium", timeStyle: "short" }).format(invoice.createdAt)}
                  </p>
                </div>
                <StatusBadge tone={INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>{t(`status.${invoice.status}`)}</StatusBadge>
              </div>
              <div className="mt-4">
                {invoice.status === "PENDING" ? (
                  <InvoicePaymentPanel invoiceId={invoice.id} provider={invoice.provider} />
                ) : (
                  <p className="text-label-sm text-on-surface-variant">{t("paidNote")}</p>
                )}
                {invoice.status === "PAID" && invoice.provider === "PAYMOB" ? (
                  <RefundRequestButton invoiceId={invoice.id} latest={invoice.refundRequests[0] ?? null} />
                ) : null}
              </div>
            </article>
          ))
        )}
      </section>
    </DashboardShell>
  );
}