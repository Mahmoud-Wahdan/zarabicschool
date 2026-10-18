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

export default function AdminInvoicesPanel({ initialInvoices, students }: { initialInvoices: InvoiceRow[]; students: StudentOption[] }) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const [invoices, setInvoices] = useState(initialInvoices);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [create, setCreate] = useState({ studentId: "", packageType: "MONTHLY_PLAN", sessionsPurchased: 8, amountMinor: "", currency: "EGP", provider: "PAYMOB" });
  const [confirm, setConfirm] = useState<Record<string, { reference: string; proofId: string }>>({});

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

  async function confirmInvoice(invoiceId: string) {
    setMessage("");
    setBusy(true);
    try {
      const state = confirm[invoiceId] ?? { reference: "", proofId: "" };
      const response = await fetch(`/api/invoices/${invoiceId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reference: state.reference || undefined,
          paymentProofId: state.proofId || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error?.message ?? t("actionFailed"));
        return;
      }
      if (payload.data?.status === "already_settled") {
        setMessage(t("alreadyPaid"));
      } else {
        setMessage(t("confirmed"));
      }
      setInvoices((current) =>
        current.map((invoice) =>
          invoice.id === invoiceId
            ? {
                ...invoice,
                status: "PAID",
                proofs: invoice.proofs.map((proof) => (state.proofId && proof.id === state.proofId ? { ...proof, status: "CONFIRMED" } : proof)),
              }
            : invoice,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function reviewProof(invoiceId: string, proofId: string, action: "CONFIRM" | "REJECT") {
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/proofs/${proofId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error?.message ?? t("actionFailed"));
        return;
      }
      setInvoices((current) =>
        current.map((invoice) =>
          invoice.id === invoiceId
            ? { ...invoice, proofs: invoice.proofs.map((proof) => (proof.id === proofId ? { ...proof, status: payload.data.status } : proof)) }
            : invoice,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

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
            <option value="ANNUAL_PLAN">{t("packageAnnual")}</option>
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
        const state = confirm[invoice.id] ?? { reference: "", proofId: "" };
        return (
          <section key={invoice.id} className="dashboard-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-[var(--navy)]">
                  {invoice.studentName} · {money(invoice.amountMinor, invoice.currency)} · {packageLabel(invoice.packageType)} · {invoice.sessionsPurchased}
                </p>
                <p className="mt-1 text-xs opacity-70">
                  {providerLabel(invoice.provider)} ·{" "}
                  {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(invoice.createdAt))}
                </p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${invoice.status === "PAID" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {t(`status.${invoice.status}`)}
              </span>
            </div>

            {invoice.proofs.length ? (
              <div className="mt-3 space-y-1 text-xs">
                <p className="font-semibold opacity-80">{t("proofsTitle")}</p>
                {invoice.proofs.map((proof) => (
                  <div key={proof.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--background)] p-2">
                    <span>{proof.originalName}</span>
                    {proof.reference ? <span className="opacity-60">· {proof.reference}</span> : null}
                    <span className={`rounded-full px-2 py-0.5 ${proof.status === "PENDING" ? "bg-amber-100 text-amber-800" : proof.status === "CONFIRMED" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                      {proof.status === "PENDING" ? t("proofPending") : proof.status === "CONFIRMED" ? t("proofConfirmed") : t("proofRejected")}
                    </span>
                    {proof.status === "PENDING" ? (
                      <>
                        <button type="button" disabled={busy} onClick={() => void reviewProof(invoice.id, proof.id, "CONFIRM")} className="rounded-lg border border-[var(--line)] px-2 py-1">{t("proofConfirmed")}</button>
                        <button type="button" disabled={busy} onClick={() => void reviewProof(invoice.id, proof.id, "REJECT")} className="rounded-lg border border-[var(--line)] px-2 py-1">{t("proofRejected")}</button>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {invoice.status === "PENDING" ? (
              <div className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-2 lg:grid-cols-4">
                <input value={state.reference} onChange={(e) => setConfirm({ ...confirm, [invoice.id]: { ...state, reference: e.target.value } })} placeholder={t("referenceLabel")} className="rounded-lg border border-[var(--line)] px-3 py-2" />
                <select value={state.proofId} onChange={(e) => setConfirm({ ...confirm, [invoice.id]: { ...state, proofId: e.target.value } })} className="rounded-lg border border-[var(--line)] px-3 py-2">
                  <option value="">{t("selectProof")}</option>
                  {invoice.proofs.filter((proof) => proof.status !== "REJECTED").map((proof) => (
                    <option key={proof.id} value={proof.id}>{proof.originalName}</option>
                  ))}
                </select>
                <button type="button" disabled={busy} onClick={() => void confirmInvoice(invoice.id)} className="cta-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50">
                  {t("confirmInvoice")}
                </button>
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
