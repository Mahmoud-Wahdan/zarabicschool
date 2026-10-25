import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import InvoicePaymentPanel from "../../../_components/invoices/invoice-payment-panel";
import StatusBadge, { type BadgeTone } from "../../../_components/ui/status-badge";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { formatMoney } from "../../../../lib/payments/format";

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

/** The guardian pays for minors (CONTEXT §20.6) — one list across all linked children. */
export default async function GuardianInvoicesPage() {
  const user = await requireRole("GUARDIAN");
  const [t, locale] = await Promise.all([getTranslations("invoices"), getLocale()]);
  const guardian = await prisma.guardian.findUnique({
    where: { userId: user.id },
    select: { students: { select: { id: true, user: { select: { displayName: true } } } } },
  });
  const studentIds = (guardian?.students ?? []).map((student) => student.id);
  const studentNames = new Map((guardian?.students ?? []).map((student) => [student.id, student.user.displayName]));

  const invoices = studentIds.length
    ? await prisma.invoice.findMany({
        where: { academyId: user.academyId, studentId: { in: studentIds } },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          studentId: true,
          amountMinor: true,
          currency: true,
          provider: true,
          packageType: true,
          sessionsPurchased: true,
          status: true,
          createdAt: true,
        },
      })
    : [];

  const packageLabel = (type: string) =>
    type === "MONTHLY_PLAN" ? t("packageMonthly") : type === "ANNUAL_PLAN" ? t("packageAnnual") : t("packagePayPerSession");
  const providerLabel = (provider: string) => (provider === "PAYMOB" ? t("providerPaymob") : t("providerUsd"));

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("title")}</h1>
      <p className="mt-2 text-sm opacity-70">{t("subtitle")}</p>

      <section className="mt-6 space-y-4">
        {invoices.length === 0 ? (
          <div className="rounded-xl border border-[var(--line)] bg-white p-6 text-sm opacity-70">
            <p>{t("empty")}</p>
            <p className="mt-1 text-xs">{t("emptyText")}</p>
          </div>
        ) : (
          invoices.map((invoice) => (
            <article key={invoice.id} className="rounded-xl border border-[var(--line)] bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-[var(--navy)]">
                    {studentNames.get(invoice.studentId)} · {formatMoney(invoice.amountMinor, invoice.currency, locale)} · {packageLabel(invoice.packageType)} · {invoice.sessionsPurchased}
                  </p>
                  <p className="mt-1 text-xs opacity-70">
                    {providerLabel(invoice.provider)} ·{" "}
                    {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(invoice.createdAt)}
                  </p>
                </div>
                <StatusBadge tone={INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>{t(`status.${invoice.status}`)}</StatusBadge>
              </div>
              <div className="mt-4">
                {invoice.status === "PENDING" ? (
                  <InvoicePaymentPanel invoiceId={invoice.id} provider={invoice.provider} />
                ) : (
                  <p className="text-xs opacity-70">{t("paidNote")}</p>
                )}
              </div>
            </article>
          ))
        )}
      </section>
    </DashboardShell>
  );
}
