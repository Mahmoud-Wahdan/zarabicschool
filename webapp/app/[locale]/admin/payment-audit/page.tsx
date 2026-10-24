import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "@/app/_components/dashboard-shell";
import EmptyState from "@/app/_components/ui/empty-state";
import PageHeader from "@/app/_components/ui/page-header";
import { requireRole } from "@/lib/dal";
import { isPaymentAuditReady } from "@/lib/payments/audit";
import { prisma } from "@/lib/prisma";

export async function generateMetadata() {
  const t = await getTranslations("paymentAudit");
  return { title: `${t("title")} | Zarabicschool` };
}

const EVENT_TYPES = ["CREATED", "PAID", "FAILED", "CANCELLED", "REJECTED", "REFUNDED"] as const;

type EventType = (typeof EVENT_TYPES)[number];

function isEventType(value: string | undefined): value is EventType {
  return !!value && (EVENT_TYPES as readonly string[]).includes(value);
}

const TONE_BY_EVENT: Record<EventType, string> = {
  CREATED: "bg-surface-container-high text-on-surface",
  PAID: "bg-primary-container text-on-primary-container",
  FAILED: "bg-error-container text-on-error-container",
  CANCELLED: "bg-surface-container-high text-on-surface-variant",
  REJECTED: "bg-error-container text-on-error-container",
  REFUNDED: "bg-tertiary-container text-on-tertiary-container",
};

/**
 * Admin-only payment audit report (Session 3, owner decision 2026-10-24): the
 * append-only `payment_audit` trail — event type, invoice, actor, timestamp and
 * the minimal safe metadata. Supervisors have NO access (money surface, server
 * gated). Read-only: audit rows are written by the business code only.
 */
export default async function PaymentAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("ADMIN");
  const locale = await getLocale();
  const t = await getTranslations("paymentAudit");
  const params = await searchParams;

  const ready = await isPaymentAuditReady();
  const rawType = Array.isArray(params.type) ? params.type[0] : params.type;
  const eventFilter = isEventType(rawType) ? rawType : null;
  const rawInvoice = Array.isArray(params.invoiceId) ? params.invoiceId[0] : params.invoiceId;
  const invoiceFilter = rawInvoice && /^[0-9a-f-]{36}$/i.test(rawInvoice) ? rawInvoice : null;

  const rows = ready
    ? await prisma.paymentAudit.findMany({
        where: {
          academyId: user.academyId,
          ...(eventFilter ? { eventType: eventFilter } : {}),
          ...(invoiceFilter ? { invoiceId: invoiceFilter } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          eventType: true,
          invoiceId: true,
          createdAt: true,
          metadata: true,
          actor: { select: { displayName: true, role: true } },
        },
      })
    : [];

  const formatter = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      {!ready ? (
        <p role="status" className="rounded-lg bg-surface-container-low px-4 py-3 text-body-sm text-on-surface-variant">
          {t("migrationPending")}
        </p>
      ) : (
        <>
          <form className="z-card flex flex-wrap items-end gap-3 rounded-xl p-4" action="/admin/payment-audit">
            <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
              {t("filterEvent")}
              <select name="type" defaultValue={eventFilter ?? ""} className="z-input min-w-40">
                <option value="">{t("filterAll")}</option>
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`events.${type}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
              {t("filterInvoice")}
              <input name="invoiceId" defaultValue={invoiceFilter ?? ""} className="z-input min-w-72" placeholder={t("filterInvoiceHint")} />
            </label>
            <button type="submit" className="btn btn-soft">
              {t("filterApply")}
            </button>
          </form>
          {rows.length === 0 ? (
            <EmptyState icon="history" title={t("empty")} />
          ) : (
            <section className="z-card overflow-x-auto rounded-xl p-4">
              <table className="w-full min-w-[640px] text-start text-body-sm">
                <thead>
                  <tr className="border-b border-outline-variant text-label-md text-on-surface-variant">
                    <th className="py-2 pe-3 text-start">{t("columnTime")}</th>
                    <th className="py-2 pe-3 text-start">{t("columnEvent")}</th>
                    <th className="py-2 pe-3 text-start">{t("columnActor")}</th>
                    <th className="py-2 pe-3 text-start">{t("columnInvoice")}</th>
                    <th className="py-2 text-start">{t("columnDetails")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const metadata = (row.metadata as Record<string, unknown> | null) ?? null;
                    const details = metadata
                      ? Object.entries(metadata)
                          .filter(([, value]) => value !== null && value !== undefined && value !== "")
                          .map(([key, value]) => `${key}: ${String(value)}`)
                          .join(" · ")
                      : "";
                    return (
                      <tr key={row.id} className="border-b border-outline-variant/60 last:border-0">
                        <td className="py-2.5 pe-3 whitespace-nowrap text-on-surface-variant">{formatter.format(row.createdAt)}</td>
                        <td className="py-2.5 pe-3">
                          <span className={`rounded px-2 py-0.5 text-label-sm font-semibold ${TONE_BY_EVENT[row.eventType as EventType] ?? "bg-surface-container-high text-on-surface"}`}>
                            {t(`events.${row.eventType}`)}
                          </span>
                        </td>
                        <td className="py-2.5 pe-3">
                          {row.actor ? row.actor.displayName : t("actorSystem")}
                        </td>
                        <td className="py-2.5 pe-3 font-mono text-label-sm text-on-surface-variant">
                          {row.invoiceId ? row.invoiceId.slice(0, 8) : "—"}
                        </td>
                        <td className="py-2.5 text-on-surface-variant">{details || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-label-sm text-on-surface-variant">{t("appendOnlyNote")}</p>
            </section>
          )}
        </>
      )}
    </DashboardShell>
  );
}
