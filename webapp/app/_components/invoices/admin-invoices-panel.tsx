"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import DataTable, { type DataRow } from "../ui/data-table";
import { type BadgeTone } from "../ui/status-badge";
import RefundForm from "./refund-form";

type InvoiceRow = {
  id: string;
  studentId: string;
  studentName: string;
  amountMinor: string;
  currency: string;
  provider: string;
  packageType: string;
  sessionsPurchased: number;
  status: "PENDING" | "PAID" | "FAILED" | "CANCELLED";
  createdAt: string;
  proofs: { id: string; status: "PENDING" | "CONFIRMED" | "REJECTED"; originalName: string; reference: string | null; uploadedBy: string }[];
};

type StudentOption = { id: string; displayName: string };

const STATUS_TONE: Record<InvoiceRow["status"], BadgeTone> = { PENDING: "pending", PAID: "success", FAILED: "danger", CANCELLED: "neutral" };

export default function AdminInvoicesPanel({ initialInvoices, students, timeZone }: { initialInvoices: InvoiceRow[]; students: StudentOption[]; timeZone: string }) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const [invoices, setInvoices] = useState(initialInvoices);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [create, setCreate] = useState({ studentId: "", packageType: "MONTHLY_PLAN", sessionsPurchased: 8, amountMinor: "", currency: "EGP", provider: "PAYMOB" });

  // S-13 (a) / D6: WhatsApp the payer a link to the platform invoices page.
  async function sendLink(invoiceId: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/send-link`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      const code = payload.error?.code;
      setMessage(response.ok ? t("linkSent") : code === "LINK_ALREADY_SENT_TODAY" ? t("linkToday") : code === "LINK_LIMIT_REACHED" ? t("linkLimit") : code === "NO_PAYER" ? t("linkNoPayer") : t("linkFailed"));
    } catch {
      setMessage(t("linkFailed"));
    } finally {
      setBusy(false);
    }
  }

  function money(amountMinor: string, currency: string) {
    return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(Number(amountMinor) / 100);
  }
  const packageLabel = (type: string) =>
    type === "MONTHLY_PLAN" ? t("packageMonthly") : type === "ANNUAL_PLAN" ? t("packageAnnual") : t("packagePayPerSession");
  const providerLabel = (provider: string) => (provider === "PAYMOB" ? t("providerPaymob") : t("providerUsd"));
  const dateFormat = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" });

  async function createInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          studentId: create.studentId,
          packageType: create.packageType,
          sessionsPurchased: Number(create.sessionsPurchased),
          amountMinor: Number(create.amountMinor),
          currency: create.currency,
          provider: create.provider,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error?.message ?? t("actionFailed"));
        return;
      }
      const studentName = students.find((student) => student.id === create.studentId)?.displayName ?? "";
      setInvoices((current) => [
        {
          id: payload.data.id,
          studentId: create.studentId,
          studentName,
          amountMinor: payload.data.amountMinor,
          currency: payload.data.currency,
          provider: create.provider,
          packageType: create.packageType,
          sessionsPurchased: Number(create.sessionsPurchased),
          status: "PENDING",
          createdAt: payload.data.createdAt,
          proofs: [],
        },
        ...current,
      ]);
      setMessage(t("created"));
      setCreate({ ...create, studentId: "", amountMinor: "" });
    } finally {
      setBusy(false);
    }
  }

  // MANUAL-PAYMENT UI HIDE (owner decision 2026-10-24 — docs/specs/phase-06-financial-management.md
  // § Session 3, Slice A): the Admin manual-confirm and proof-review UI is hidden. The APIs stay
  // reachable with unchanged authorization ("dormant but reachable" — listed in the phase spec):
  //   POST /api/invoices/[id]/confirm            (ADMIN)
  //   POST /api/invoices/[id]/proofs/[proofId]   (ADMIN)
  // Invoice creation, the invoice list and statuses STAY (the gateway "Pay now" flow needs the
  // Admin-created invoice). The removed JSX/functions live in git history at this commit.

  return (
    <div className="space-y-6">
      <section className="z-card rounded-xl p-5">
        <h2 className="font-semibold text-primary">{t("createTitle")}</h2>
        <p className="mt-1 text-label-sm text-on-surface-variant">{t("createHint")}</p>
        <form onSubmit={createInvoice} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <select required value={create.studentId} onChange={(e) => setCreate({ ...create, studentId: e.target.value })} className="z-input">
            <option value="">{t("colStudent")}</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>{student.displayName}</option>
            ))}
          </select>
          <select value={create.packageType} onChange={(e) => setCreate({ ...create, packageType: e.target.value })} className="z-input">
            <option value="MONTHLY_PLAN">{t("packageMonthly")}</option>
            {/* ANNUAL_PLAN hidden until PLAN_GRANT exists (A4, owner 2026-10-26); the API refuses it too. */}
            <option value="PAY_PER_SESSION">{t("packagePayPerSession")}</option>
          </select>
          <input type="number" min={1} max={500} required value={create.sessionsPurchased} onChange={(e) => setCreate({ ...create, sessionsPurchased: Number(e.target.value) })} placeholder={t("colSessions")} className="z-input" />
          <input type="number" min={1} required value={create.amountMinor} onChange={(e) => setCreate({ ...create, amountMinor: e.target.value })} placeholder={t("amountMinorLabel")} className="z-input lg:col-span-2" />
          <div className="flex gap-2">
            <select value={create.currency} onChange={(e) => setCreate({ ...create, currency: e.target.value, provider: e.target.value === "USD" ? "USD_GATEWAY" : "PAYMOB" })} className="min-w-0 flex-1 z-input">
              <option value="EGP">EGP</option>
              <option value="USD">USD</option>
            </select>
            <button type="submit" disabled={busy} className="btn btn-primary disabled:opacity-50">{t("createInvoice")}</button>
          </div>
        </form>
      </section>

      <section className="z-card overflow-hidden rounded-xl pt-4 sm:pt-6" aria-labelledby="invoice-list">
        <h2 id="invoice-list" className="px-4 pb-3 text-headline-sm font-bold text-primary sm:px-6">{t("listTitle")}</h2>
        <DataTable
          caption={t("listTitle")}
          columns={[
            { key: "student", label: t("colStudent") },
            { key: "amount", label: t("colAmount") },
            { key: "package", label: t("colPackage") },
            { key: "sessions", label: t("colSessions") },
            { key: "provider", label: t("colProvider") },
            { key: "created", label: t("colCreated") },
            { key: "status", label: t("colStatus") },
          ]}
          rows={invoices.map((invoice): DataRow => ({
            id: invoice.id,
            filter: invoice.status,
            cells: {
              student: { text: invoice.studentName, strong: true },
              amount: { text: money(invoice.amountMinor, invoice.currency), sort: Number(invoice.amountMinor), numeric: true },
              package: { text: packageLabel(invoice.packageType) },
              sessions: { text: String(invoice.sessionsPurchased), sort: invoice.sessionsPurchased, numeric: true },
              provider: { text: providerLabel(invoice.provider) },
              created: { text: dateFormat.format(new Date(invoice.createdAt)), sort: invoice.createdAt, numeric: true },
              status: { text: t(`status.${invoice.status}`), tone: STATUS_TONE[invoice.status] },
            },
          }))}
          quickFilters={(["PENDING", "PAID", "FAILED", "CANCELLED"] as const).map((status) => ({ key: status, label: t(`status.${status}`) }))}
          exportName="zarabicschool-invoices"
          emptyTitle={t("empty")}
          emptyIcon="receipt_long"
          initialSort={{ key: "created", direction: "desc" }}
          actions={{
            label: t("colActions"),
            render: (id) => {
              const invoice = invoices.find((row) => row.id === id);
              if (!invoice) return null;
              if (invoice.status === "PENDING") {
                return (
                  <button type="button" disabled={busy} onClick={() => void sendLink(invoice.id)} className="btn btn-outline disabled:opacity-50" title={t("sendLinkHint")}>
                    {t("sendLink")}
                  </button>
                );
              }
              if (invoice.status === "PAID" && invoice.provider === "PAYMOB") {
                return (
                  <button type="button" aria-expanded={refundFor === invoice.id} onClick={() => setRefundFor(refundFor === invoice.id ? null : invoice.id)} className="btn btn-outline">
                    {t("refund")}
                  </button>
                );
              }
              return null;
            },
          }}
          expanded={(id) => {
            const invoice = invoices.find((row) => row.id === id);
            if (!invoice || refundFor !== id) return null;
            return <RefundForm defaultOpen onClose={() => setRefundFor(null)} timeZone={timeZone} invoiceId={invoice.id} amountMinor={invoice.amountMinor} currency={invoice.currency} sessionsPurchased={invoice.sessionsPurchased} />;
          }}
        />
      </section>
      {message ? <p role="status" className="rounded-lg bg-surface-container-low px-3 py-2 text-body-sm text-on-surface">{message}</p> : null}
    </div>
  );
}
