"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

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

export default function AdminInvoicesPanel({ initialInvoices, students, timeZone }: { initialInvoices: InvoiceRow[]; students: StudentOption[]; timeZone: string }) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const [invoices, setInvoices] = useState(initialInvoices);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
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
      <section className="dashboard-card p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("createTitle")}</h2>
        <p className="mt-1 text-xs opacity-70">{t("createHint")}</p>
        <form onSubmit={createInvoice} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <select required value={create.studentId} onChange={(e) => setCreate({ ...create, studentId: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2">
            <option value="">{t("colStudent")}</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>{student.displayName}</option>
            ))}
          </select>
          <select value={create.packageType} onChange={(e) => setCreate({ ...create, packageType: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2">
            <option value="MONTHLY_PLAN">{t("packageMonthly")}</option>
            {/* ANNUAL_PLAN hidden until PLAN_GRANT exists (A4, owner 2026-10-26); the API refuses it too. */}
            <option value="PAY_PER_SESSION">{t("packagePayPerSession")}</option>
          </select>
          <input type="number" min={1} max={500} required value={create.sessionsPurchased} onChange={(e) => setCreate({ ...create, sessionsPurchased: Number(e.target.value) })} placeholder={t("colSessions")} className="rounded-lg border border-[var(--line)] px-3 py-2" />
          <input type="number" min={1} required value={create.amountMinor} onChange={(e) => setCreate({ ...create, amountMinor: e.target.value })} placeholder={t("amountMinorLabel")} className="rounded-lg border border-[var(--line)] px-3 py-2 lg:col-span-2" />
          <div className="flex gap-2">
            <select value={create.currency} onChange={(e) => setCreate({ ...create, currency: e.target.value, provider: e.target.value === "USD" ? "USD_GATEWAY" : "PAYMOB" })} className="min-w-0 flex-1 rounded-lg border border-[var(--line)] px-3 py-2">
              <option value="EGP">EGP</option>
              <option value="USD">USD</option>
            </select>
            <button type="submit" disabled={busy} className="cta-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50">{t("createInvoice")}</button>
          </div>
        </form>
      </section>

      {invoices.map((invoice) => {
        return (
          <section key={invoice.id} className="dashboard-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-[var(--navy)]">
                  {invoice.studentName} · {money(invoice.amountMinor, invoice.currency)} · {packageLabel(invoice.packageType)} · {invoice.sessionsPurchased}
                </p>
                <p className="mt-1 text-xs opacity-70">
                  {providerLabel(invoice.provider)} ·{" "}
                  {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(invoice.createdAt))}
                </p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${invoice.status === "PAID" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {t(`status.${invoice.status}`)}
              </span>
            </div>
            {invoice.status === "PENDING" ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" disabled={busy} onClick={() => void sendLink(invoice.id)} className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm text-[var(--navy)] hover:border-[var(--navy)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]">
                  {t("sendLink")}
                </button>
                <span className="text-xs opacity-70">{t("sendLinkHint")}</span>
              </div>
            ) : null}
          </section>
        );
      })}
      {invoices.length === 0 ? <p className="text-sm opacity-70">{t("empty")}</p> : null}
      {message ? <p role="status" className="text-sm opacity-75">{message}</p> : null}
    </div>
  );
}
