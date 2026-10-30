"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import DataTable, { type DataRow } from "../ui/data-table";
import StatusBadge, { type BadgeTone } from "../ui/status-badge";
import ChargeDateRail from "./charge-date-rail";
import { upcomingChargeDates } from "../../../lib/billing/renewal-dates";

/**
 * Automatic monthly renewal for the payer (D52-D57). Sign-up: student + monthly plan,
 * the real charge dates, an explicit unticked consent box, then Paymob's Unified
 * Checkout — the first payment is month 1 (D55). A live renewal shows its state and
 * a two-step cancel (D52: no more charges, the paid period stays). Nothing is marked
 * paid here; the signed webhook is authoritative.
 */
export type PanelSubscription = {
  id: string;
  studentId: string;
  studentName: string;
  planName: string;
  payerName: string;
  priceLabel: string;
  status: "INCOMPLETE" | "ACTIVE" | "PAST_DUE" | "CANCELED";
  autoRenew: boolean;
  currentPeriodEnd: string;
  graceEndsAt: string | null;
};

type Props = {
  students: { id: string; name: string }[];
  plans: { id: string; name: string; sessions: number; priceLabel: string; priceMinor: string }[];
  subscriptions: PanelSubscription[];
  timeZone: string;
  /** Server time (ISO) so the dates the payer sees match the server's. */
  now: string;
  /** Admin view: cancel only, no sign-up (the payer gives consent, never the Admin). */
  mode?: "payer" | "admin";
};

const TONE: Record<PanelSubscription["status"], BadgeTone> = { INCOMPLETE: "pending", ACTIVE: "success", PAST_DUE: "danger", CANCELED: "neutral" };

function useDateFormat(timeZone: string) {
  const locale = useLocale();
  return useMemo(() => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone, dateStyle: "medium" }), [locale, timeZone]);
}

export function RenewalRow({ subscription, timeZone, showPayer = false }: { subscription: PanelSubscription; timeZone: string; showPayer?: boolean }) {
  const t = useTranslations("renewal");
  const date = useDateFormat(timeZone);
  const [state, setState] = useState<"idle" | "confirm" | "busy" | "done">("idle");
  const [message, setMessage] = useState("");
  const periodEnd = date.format(new Date(subscription.currentPeriodEnd));
  const cancelled = state === "done" || (!subscription.autoRenew && subscription.status !== "INCOMPLETE");
  const statusText = cancelled && subscription.status !== "CANCELED" ? t("cancelScheduled", { date: periodEnd }) : t(`status.${subscription.status}`);

  async function cancel() {
    setState("busy");
    setMessage("");
    try {
      const response = await fetch(`/api/billing/subscriptions/${subscription.id}/cancel`, { method: "POST" });
      if (!response.ok) {
        setState("confirm");
        setMessage(t("cancelFailed"));
        return;
      }
      setState("done");
      setMessage(t("cancelled", { date: periodEnd }));
    } catch {
      setState("confirm");
      setMessage(t("cancelFailed"));
    }
  }

  return (
    <article className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-primary">{subscription.studentName}</p>
          <p className="mt-1 text-body-sm text-on-surface-variant">{t("planLine", { plan: subscription.planName, price: subscription.priceLabel })}</p>
          {showPayer ? <p className="mt-1 text-label-sm text-on-surface-variant">{t("payer", { name: subscription.payerName })}</p> : null}
        </div>
        <StatusBadge tone={cancelled ? "neutral" : TONE[subscription.status]}>{statusText}</StatusBadge>
      </div>
      {!cancelled && subscription.status === "ACTIVE" ? <p className="mt-3 text-sm">{t("nextCharge", { date: periodEnd })}</p> : null}
      {!cancelled && subscription.status === "PAST_DUE" && subscription.graceEndsAt ? (
        <p className="mt-3 rounded-lg bg-[var(--status-danger)]/10 p-3 text-sm">{t("graceUntil", { date: date.format(new Date(subscription.graceEndsAt)) })}</p>
      ) : null}
      {!cancelled && (subscription.status === "ACTIVE" || subscription.status === "PAST_DUE") ? (
        <div className="mt-4">
          {state === "idle" ? (
            <button type="button" onClick={() => setState("confirm")} className="btn btn-outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              {t("cancel")}
            </button>
          ) : (
            <div className="space-y-3 rounded-lg border border-tertiary-container bg-tertiary-fixed/40 p-4">
              <p className="text-sm">{subscription.status === "PAST_DUE" ? t("cancelConfirmPastDue") : t("cancelConfirm", { date: periodEnd })}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={state === "busy"} onClick={() => void cancel()} className="btn btn-primary disabled:opacity-50">
                  {t("cancelYes")}
                </button>
                <button type="button" disabled={state === "busy"} onClick={() => { setState("idle"); setMessage(""); }} className="rounded-xl px-4 py-2 text-sm text-primary underline-offset-4 hover:underline">
                  {t("cancelKeep")}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {message ? <p role="status" className="mt-3 text-body-sm text-on-surface-variant">{message}</p> : null}
    </article>
  );
}

/** Admin view (owner, 2026-10-31: long lists are tables): one row per renewal; "Manage" opens its cancel controls. */
function AdminRenewalsTable({ subscriptions, timeZone }: { subscriptions: PanelSubscription[]; timeZone: string }) {
  const t = useTranslations("renewal");
  const date = useDateFormat(timeZone);
  const [open, setOpen] = useState<string | null>(null);
  const rows = subscriptions.map((row): DataRow => ({
    id: row.id,
    filter: row.status,
    cells: {
      student: { text: row.studentName, strong: true },
      payer: { text: row.payerName },
      plan: { text: row.planName },
      price: { text: row.priceLabel, numeric: true },
      status: { text: !row.autoRenew && row.status !== "CANCELED" && row.status !== "INCOMPLETE" ? t("cancelScheduled", { date: date.format(new Date(row.currentPeriodEnd)) }) : t(`status.${row.status}`), tone: !row.autoRenew && row.status !== "INCOMPLETE" ? "neutral" : TONE[row.status] },
      periodEnd: { text: date.format(new Date(row.currentPeriodEnd)), sort: row.currentPeriodEnd, numeric: true },
      grace: { text: row.status === "PAST_DUE" && row.graceEndsAt ? date.format(new Date(row.graceEndsAt)) : "—", sort: row.graceEndsAt ?? "", numeric: true },
    },
  }));
  return (
    <div className="z-card overflow-hidden rounded-xl pt-4 sm:pt-6">
      <DataTable
        caption={t("title")}
        columns={[
          { key: "student", label: t("colStudent") },
          { key: "payer", label: t("colPayer") },
          { key: "plan", label: t("colPlan") },
          { key: "price", label: t("colPrice") },
          { key: "status", label: t("colStatus") },
          { key: "periodEnd", label: t("colPeriodEnd") },
          { key: "grace", label: t("colGrace") },
        ]}
        rows={rows}
        quickFilters={(["ACTIVE", "PAST_DUE", "INCOMPLETE", "CANCELED"] as const).map((status) => ({ key: status, label: t(`status.${status}`) }))}
        exportName="zarabicschool-renewals"
        emptyTitle={t("adminEmpty")}
        emptyIcon="autorenew"
        initialSort={{ key: "periodEnd", direction: "asc" }}
        actions={{
          label: t("colActions"),
          render: (id) => {
            const row = subscriptions.find((entry) => entry.id === id);
            if (!row || !row.autoRenew || (row.status !== "ACTIVE" && row.status !== "PAST_DUE")) return null;
            return (
              <button type="button" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)} className="btn btn-outline">
                {t("manage")}
              </button>
            );
          },
        }}
        expanded={(id) => {
          const row = subscriptions.find((entry) => entry.id === id);
          return row && open === id ? <RenewalRow subscription={row} timeZone={timeZone} showPayer /> : null;
        }}
      />
    </div>
  );
}

export default function AutoRenewPanel({ students, plans, subscriptions, timeZone, now, mode = "payer" }: Props) {
  const t = useTranslations("renewal");
  const locale = useLocale();
  const live = new Set(subscriptions.filter((row) => row.status !== "CANCELED").map((row) => row.studentId));
  const eligible = students.filter((student) => !live.has(student.id));
  const [studentId, setStudentId] = useState(eligible[0]?.id ?? "");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const plan = plans.find((entry) => entry.id === planId);
  const dates = useMemo(() => upcomingChargeDates(new Date(now), timeZone, 3), [now, timeZone]);

  async function start() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/billing/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId, planId, consent: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.checkoutUrl) {
        const code = payload.error?.code;
        setMessage(code === "NOT_CONFIGURED" ? t("notReady") : code === "ALREADY_SUBSCRIBED" ? t("alreadyOn") : t("failed"));
        return;
      }
      setMessage(t("redirecting"));
      window.location.href = payload.checkoutUrl as string;
    } catch {
      setMessage(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="auto-renew-title" className="space-y-4">
      <h2 id="auto-renew-title" className={mode === "admin" ? "sr-only" : "text-headline-sm font-bold text-primary"}>{t("title")}</h2>
      {mode === "admin" ? <AdminRenewalsTable subscriptions={subscriptions} timeZone={timeZone} /> : subscriptions.map((row) => <RenewalRow key={row.id} subscription={row} timeZone={timeZone} />)}
      {mode === "admin" ? null : plans.length === 0 ? (
        <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5 text-body-sm text-on-surface-variant">{t("noPlans")}</p>
      ) : eligible.length === 0 ? null : (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5 shadow-[var(--dashboard-shadow)] sm:p-6">
          <p className="max-w-prose text-sm leading-relaxed">{t("intro")}</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-primary">{t("student")}</span>
              <select value={studentId} onChange={(event) => setStudentId(event.target.value)} className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                {eligible.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-primary">{t("plan")}</span>
              <select value={planId} onChange={(event) => setPlanId(event.target.value)} className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                {plans.map((entry) => <option key={entry.id} value={entry.id}>{t("planOption", { plan: entry.name, sessions: entry.sessions, price: entry.priceLabel })}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-6">
            <p className="mb-3 text-sm font-medium text-primary">{t("calendarLabel")}</p>
            <ChargeDateRail dates={dates} locale={locale} firstLabel={t("today")} laterLabel={t("autoCharge", { price: plan?.priceLabel ?? "" })} />
            <p className="mt-3 text-label-sm text-on-surface-variant">{t("shortMonthNote")}</p>
          </div>
          <label className="mt-6 flex items-start gap-3 rounded-lg bg-surface p-4 text-sm leading-relaxed">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
            <span>{t("consent", { price: plan?.priceLabel ?? "" })}</span>
          </label>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" aria-busy={busy} disabled={!consent || busy || !studentId || !planId} onClick={() => void start()} className="btn btn-primary px-5 py-2.5 text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              {t("start")}
            </button>
            <p className="text-label-sm text-on-surface-variant">{t("cancelAnyTime")}</p>
          </div>
          {message ? <p role="status" className="mt-3 text-body-sm text-on-surface-variant">{message}</p> : null}
        </div>
      )}
    </section>
  );
}
