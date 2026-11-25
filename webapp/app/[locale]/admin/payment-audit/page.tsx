import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "@/app/_components/dashboard-shell";
import { PrintEvidenceButton } from "@/app/_components/invoices/chargeback-evidence-panel";
import EmptyState from "@/app/_components/ui/empty-state";
import PageHeader from "@/app/_components/ui/page-header";
import { Link } from "@/i18n/navigation";
import { requireRole } from "@/lib/dal";
import { isPaymentAuditReady } from "@/lib/payments/audit";
import { PAYMENT_AUDIT_EVENT_TYPES } from "@/lib/payments/audit-events";
import {
  getChargebackEvidence,
  getReconciliationReport,
  getSystemAuditFeed,
} from "@/lib/payments/compliance";
import { formatMoney } from "@/lib/payments/format";
import { prisma } from "@/lib/prisma";

export async function generateMetadata() {
  const t = await getTranslations("paymentAudit");
  return { title: `${t("title")} | Zarabicschool` };
}

const EVENT_TYPES = PAYMENT_AUDIT_EVENT_TYPES;
type EventType = (typeof EVENT_TYPES)[number];
type TabKey = "payments" | "reconciliation" | "chargeback" | "system";

function isEventType(value: string | undefined): value is EventType {
  return !!value && (EVENT_TYPES as readonly string[]).includes(value);
}

function parseTab(value: string | undefined): TabKey {
  if (value === "reconciliation" || value === "chargeback" || value === "system") return value;
  return "payments";
}

const TONE_BY_EVENT: Record<EventType, string> = {
  CREATED: "bg-surface-container-high text-on-surface",
  PAID: "bg-primary-container text-on-primary-container",
  FAILED: "bg-error-container text-on-error-container",
  CANCELLED: "bg-surface-container-high text-on-surface-variant",
  REJECTED: "bg-error-container text-on-error-container",
  REFUNDED: "bg-tertiary-container text-on-tertiary-container",
  LINK_SENT: "bg-surface-container-high text-on-surface",
  REFUND_REQUESTED: "bg-surface-container-high text-on-surface",
  REFUND_FAILED: "bg-error-container text-on-error-container",
  VOIDED: "bg-tertiary-container text-on-tertiary-container",
  PROVIDER_REFUND_SEEN: "bg-tertiary-container text-on-tertiary-container",
};

/**
 * Admin-only payment audit & compliance hub:
 *  - payments: append-only `payment_audit` trail
 *  - reconciliation: invoice vs Paymob reference & refund totals + CSV export
 *  - chargeback: per-invoice proof-of-service package (consent, clicks, attendance, reports)
 *  - system: webhook events & session link audits
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

  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab = parseTab(rawTab);

  const ready = await isPaymentAuditReady();
  const rawType = Array.isArray(params.type) ? params.type[0] : params.type;
  const eventFilter = isEventType(rawType) ? rawType : null;
  const rawInvoice = Array.isArray(params.invoiceId) ? params.invoiceId[0] : params.invoiceId;
  const invoiceFilter = rawInvoice && /^[0-9a-f-]{36}$/i.test(rawInvoice) ? rawInvoice : null;

  const formatter = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    timeZone: user.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });

  const [auditRows, reconciliation, evidence, systemFeed] = await Promise.all([
    tab === "payments" && ready
      ? prisma.paymentAudit.findMany({
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
      : Promise.resolve([]),
    tab === "reconciliation" ? getReconciliationReport(user.academyId) : Promise.resolve(null),
    tab === "chargeback" && invoiceFilter ? getChargebackEvidence(user.academyId, invoiceFilter) : Promise.resolve(null),
    tab === "system" ? getSystemAuditFeed(user.academyId) : Promise.resolve(null),
  ]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "payments", label: t("tabs.payments") },
    { key: "reconciliation", label: t("tabs.reconciliation") },
    { key: "chargeback", label: t("tabs.chargeback") },
    { key: "system", label: t("tabs.system") },
  ];

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />

      <nav aria-label={t("tabsLabel")} className="flex flex-wrap gap-2 print:hidden">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={`/admin/payment-audit?tab=${item.key}${invoiceFilter && item.key === "chargeback" ? `&invoiceId=${invoiceFilter}` : ""}`}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
              tab === item.key
                ? "border-primary bg-primary text-on-primary"
                : "border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:border-primary/50"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "payments" ? (
        !ready ? (
          <p role="status" className="rounded-lg bg-surface-container-low px-4 py-3 text-body-sm text-on-surface-variant">
            {t("migrationPending")}
          </p>
        ) : (
          <>
            <form className="z-card flex flex-wrap items-end gap-3 rounded-xl p-4" action="/admin/payment-audit">
              <input type="hidden" name="tab" value="payments" />
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
            {auditRows.length === 0 ? (
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
                    {auditRows.map((row) => {
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
                          <td className="py-2.5 pe-3">{row.actor ? row.actor.displayName : t("actorSystem")}</td>
                          <td className="py-2.5 pe-3 font-mono text-label-sm text-on-surface-variant">
                            {row.invoiceId ? (
                              <Link
                                href={`/admin/payment-audit?tab=chargeback&invoiceId=${row.invoiceId}`}
                                className="text-primary underline hover:opacity-80"
                              >
                                {row.invoiceId.slice(0, 8)}
                              </Link>
                            ) : (
                              "—"
                            )}
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
        )
      ) : null}

      {tab === "reconciliation" && reconciliation ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body-sm text-on-surface-variant">{t("reconciliation.subtitle")}</p>
            <a href="/api/admin/reconciliation/export" className="btn btn-primary px-4 py-2 text-sm">
              {t("reconciliation.exportCsv")}
            </a>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {reconciliation.totals.map((cur) => (
              <div key={cur.currency} className="z-card rounded-xl p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-secondary">{cur.currency}</p>
                <p className="text-lg font-bold text-primary">
                  {t("reconciliation.net")}: {formatMoney(cur.netMinor, cur.currency, locale)}
                </p>
                <p className="text-xs text-on-surface-variant">
                  {t("reconciliation.paid")}: {formatMoney(cur.paidMinor, cur.currency, locale)} ({cur.paidCount}) ·{" "}
                  {t("reconciliation.refunded")}: {formatMoney(cur.refundedMinor, cur.currency, locale)} ({cur.refundedCount})
                </p>
              </div>
            ))}
            <div className="z-card rounded-xl p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-secondary">{t("reconciliation.webhooksTitle")}</p>
              <p className="text-lg font-bold text-primary">{reconciliation.unmatchedWebhooksCount}</p>
              <p className="text-xs text-on-surface-variant">{t("reconciliation.unmatchedHint")}</p>
            </div>
          </div>

          {reconciliation.invoices.length === 0 ? (
            <EmptyState icon="receipt_long" title={t("empty")} />
          ) : (
            <section className="z-card overflow-x-auto rounded-xl p-4">
              <table className="w-full min-w-[760px] text-start text-body-sm">
                <thead>
                  <tr className="border-b border-outline-variant text-label-md text-on-surface-variant">
                    <th className="py-2 pe-3 text-start">{t("columnInvoice")}</th>
                    <th className="py-2 pe-3 text-start">{t("reconciliation.student")}</th>
                    <th className="py-2 pe-3 text-start">{t("reconciliation.reference")}</th>
                    <th className="py-2 pe-3 text-start">{t("reconciliation.status")}</th>
                    <th className="py-2 pe-3 text-start">{t("reconciliation.amount")}</th>
                    <th className="py-2 pe-3 text-start">{t("reconciliation.refunded")}</th>
                    <th className="py-2 pe-3 text-start">{t("reconciliation.consent")}</th>
                    <th className="py-2 text-start">{t("reconciliation.evidence")}</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliation.invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-outline-variant/60 last:border-0">
                      <td className="py-2.5 pe-3 font-mono text-xs">{inv.id.slice(0, 8)}</td>
                      <td className="py-2.5 pe-3">{inv.student.user.displayName}</td>
                      <td className="py-2.5 pe-3 font-mono text-xs text-on-surface-variant">{inv.providerReference ?? "—"}</td>
                      <td className="py-2.5 pe-3 font-semibold">{inv.status}</td>
                      <td className="py-2.5 pe-3 whitespace-nowrap">{formatMoney(inv.amountMinor, inv.currency, locale)}</td>
                      <td className="py-2.5 pe-3 whitespace-nowrap">
                        {inv.refundedMinor > BigInt(0) ? formatMoney(inv.refundedMinor, inv.currency, locale) : "—"}
                      </td>
                      <td className="py-2.5 pe-3 whitespace-nowrap text-xs text-on-surface-variant">
                        {inv.termsConsentAt ? formatter.format(inv.termsConsentAt) : "—"}
                      </td>
                      <td className="py-2.5">
                        <Link
                          href={`/admin/payment-audit?tab=chargeback&invoiceId=${inv.id}`}
                          className="text-xs font-semibold text-primary underline"
                        >
                          {t("reconciliation.viewEvidence")}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      ) : null}

      {tab === "chargeback" ? (
        <div className="space-y-4">
          <form className="z-card flex flex-wrap items-end gap-3 rounded-xl p-4 print:hidden" action="/admin/payment-audit">
            <input type="hidden" name="tab" value="chargeback" />
            <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
              {t("filterInvoice")}
              <input name="invoiceId" defaultValue={invoiceFilter ?? ""} className="z-input min-w-80" placeholder={t("filterInvoiceHint")} />
            </label>
            <button type="submit" className="btn btn-primary">
              {t("chargeback.load")}
            </button>
          </form>

          {!invoiceFilter ? (
            <EmptyState icon="description" title={t("chargeback.prompt")} />
          ) : !evidence ? (
            <EmptyState icon="search" title={t("chargeback.notFound")} />
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-primary">
                    {t("chargeback.packageTitle")} · {evidence.invoice.id.slice(0, 8)}
                  </h2>
                  <p className="text-xs text-on-surface-variant">
                    {t("chargeback.generatedAt")}: {formatter.format(new Date(evidence.generatedAt))}
                  </p>
                </div>
                <div className="flex items-center gap-2 print:hidden">
                  <PrintEvidenceButton label={t("chargeback.printPdf")} />
                  <a
                    href={`/api/admin/invoices/${evidence.invoice.id}/evidence`}
                    className="btn btn-primary px-4 py-2 text-sm"
                  >
                    {t("chargeback.downloadJson")}
                  </a>
                </div>
              </div>

              <section className="z-card rounded-xl p-5 space-y-3">
                <h3 className="text-base font-bold text-primary">{t("chargeback.invoiceSection")}</h3>
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                  <div>
                    <dt className="text-xs text-on-surface-variant">{t("columnInvoice")}</dt>
                    <dd className="font-mono">{evidence.invoice.id}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-on-surface-variant">{t("reconciliation.amount")}</dt>
                    <dd className="font-semibold">
                      {formatMoney(evidence.invoice.amountMinor, evidence.invoice.currency, locale)} ({evidence.invoice.status})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-on-surface-variant">{t("reconciliation.reference")}</dt>
                    <dd className="font-mono">{evidence.invoice.providerReference ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-on-surface-variant">{t("reconciliation.student")}</dt>
                    <dd>
                      {evidence.invoice.student.user.displayName}
                      {evidence.invoice.student.guardian ? ` (${evidence.invoice.student.guardian.user.displayName})` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-on-surface-variant">{t("chargeback.paidAt")}</dt>
                    <dd>{evidence.invoice.paidAt ? formatter.format(evidence.invoice.paidAt) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-on-surface-variant">{t("reconciliation.consent")}</dt>
                    <dd>{evidence.invoice.termsConsentAt ? formatter.format(evidence.invoice.termsConsentAt) : "—"}</dd>
                  </div>
                </dl>
              </section>

              <section className="z-card rounded-xl p-5 space-y-3">
                <h3 className="text-base font-bold text-primary">
                  {t("chargeback.sessionsSection")} ({evidence.sessions.length})
                </h3>
                {evidence.sessions.length === 0 ? (
                  <p className="text-sm text-on-surface-variant">{t("chargeback.noSessions")}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-start text-body-sm">
                      <thead>
                        <tr className="border-b border-outline-variant text-label-md text-on-surface-variant">
                          <th className="py-2 pe-3 text-start">{t("columnTime")}</th>
                          <th className="py-2 pe-3 text-start">{t("chargeback.subject")}</th>
                          <th className="py-2 pe-3 text-start">{t("chargeback.teacher")}</th>
                          <th className="py-2 pe-3 text-start">{t("chargeback.attendance")}</th>
                          <th className="py-2 pe-3 text-start">{t("chargeback.joinClicks")}</th>
                          <th className="py-2 text-start">{t("chargeback.reports")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {evidence.sessions.map((s) => (
                          <tr key={s.sessionId} className="border-b border-outline-variant/60 last:border-0">
                            <td className="py-2 pe-3 whitespace-nowrap">{formatter.format(s.scheduledStart)}</td>
                            <td className="py-2 pe-3">{locale === "ar" ? s.subject.nameAr : s.subject.nameEn}</td>
                            <td className="py-2 pe-3">{s.teacherName}</td>
                            <td className="py-2 pe-3 font-semibold">{s.attendanceStatus}</td>
                            <td className="py-2 pe-3 text-xs">
                              {s.joinClicks.length > 0
                                ? s.joinClicks.map((c) => `${c.user.role} @ ${formatter.format(c.clickedAt)}`).join(" · ")
                                : "—"}
                            </td>
                            <td className="py-2 text-xs">
                              {s.reports.length > 0 ? s.reports.map((r) => `${r.status}`).join(", ") : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      ) : null}

      {tab === "system" && systemFeed ? (
        <div className="space-y-6">
          <section className="z-card overflow-x-auto rounded-xl p-4 space-y-3">
            <h2 className="text-base font-bold text-primary">{t("system.webhooksTitle")}</h2>
            {systemFeed.webhookEvents.length === 0 ? (
              <p className="text-sm text-on-surface-variant">{t("empty")}</p>
            ) : (
              <table className="w-full min-w-[600px] text-start text-body-sm">
                <thead>
                  <tr className="border-b border-outline-variant text-label-md text-on-surface-variant">
                    <th className="py-2 pe-3 text-start">{t("columnTime")}</th>
                    <th className="py-2 pe-3 text-start">{t("system.provider")}</th>
                    <th className="py-2 pe-3 text-start">{t("columnEvent")}</th>
                    <th className="py-2 pe-3 text-start">{t("reconciliation.reference")}</th>
                    <th className="py-2 text-start">{t("reconciliation.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {systemFeed.webhookEvents.map((ev) => (
                    <tr key={ev.id} className="border-b border-outline-variant/60 last:border-0">
                      <td className="py-2 pe-3 whitespace-nowrap">{formatter.format(ev.createdAt)}</td>
                      <td className="py-2 pe-3">{ev.provider}</td>
                      <td className="py-2 pe-3">{ev.eventType}</td>
                      <td className="py-2 pe-3 font-mono text-xs">{ev.providerEventId}</td>
                      <td className="py-2 font-semibold">{ev.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="z-card overflow-x-auto rounded-xl p-4 space-y-3">
            <h2 className="text-base font-bold text-primary">{t("system.linkAuditsTitle")}</h2>
            {systemFeed.linkAudits.length === 0 ? (
              <p className="text-sm text-on-surface-variant">{t("empty")}</p>
            ) : (
              <table className="w-full min-w-[600px] text-start text-body-sm">
                <thead>
                  <tr className="border-b border-outline-variant text-label-md text-on-surface-variant">
                    <th className="py-2 pe-3 text-start">{t("columnTime")}</th>
                    <th className="py-2 pe-3 text-start">{t("columnActor")}</th>
                    <th className="py-2 pe-3 text-start">{t("system.source")}</th>
                    <th className="py-2 text-start">{t("columnDetails")}</th>
                  </tr>
                </thead>
                <tbody>
                  {systemFeed.linkAudits.map((row) => (
                    <tr key={row.id} className="border-b border-outline-variant/60 last:border-0">
                      <td className="py-2 pe-3 whitespace-nowrap">{formatter.format(row.createdAt)}</td>
                      <td className="py-2 pe-3">{row.changedBy.displayName}</td>
                      <td className="py-2 pe-3">{row.source}</td>
                      <td className="py-2 text-xs text-on-surface-variant">
                        join: {String(row.joinUrlChanged)} · host: {String(row.hostUrlChanged)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : null}
    </DashboardShell>
  );
}
