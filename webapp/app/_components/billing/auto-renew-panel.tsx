"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

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
    <article className="rounded-xl border border-[var(--line)] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[var(--navy)]">{subscription.studentName}</p>
          <p className="mt-1 text-sm opacity-75">{t("planLine", { plan: subscription.planName, price: subscription.priceLabel })}</p>
          {showPayer ? <p className="mt-1 text-xs opacity-70">{t("payer", { name: subscription.payerName })}</p> : null}
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
            <button type="button" onClick={() => setState("confirm")} className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm text-[var(--navy)] hover:border-[var(--navy)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]">
              {t("cancel")}
            </button>
          ) : (
            <div className="space-y-3 rounded-lg border border-[var(--gold)]/50 bg-[var(--gold)]/10 p-4">
              <p className="text-sm">{subscription.status === "PAST_DUE" ? t("cancelConfirmPastDue") : t("cancelConfirm", { date: periodEnd })}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={state === "busy"} onClick={() => void cancel()} className="cta-primary rounded-xl px-4 py-2 text-sm disabled:opacity-50">
                  {t("cancelYes")}
                </button>
                <button type="button" disabled={state === "busy"} onClick={() => { setState("idle"); setMessage(""); }} className="rounded-xl px-4 py-2 text-sm text-[var(--navy)] underline-offset-4 hover:underline">
                  {t("cancelKeep")}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {message ? <p role="status" className="mt-3 text-sm opacity-80">{message}</p> : null}
    </article>
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
      <h2 id="auto-renew-title" className={mode === "admin" ? "sr-only" : "text-lg font-bold text-[var(--navy)]"}>{t("title")}</h2>
      {subscriptions.map((row) => <RenewalRow key={row.id} subscription={row} timeZone={timeZone} showPayer={mode === "admin"} />)}
      {mode === "admin" ? (
        subscriptions.length === 0 ? <p className="text-sm opacity-70">{t("adminEmpty")}</p> : null
      ) : plans.length === 0 ? (
        <p className="rounded-xl border border-[var(--line)] bg-white p-5 text-sm opacity-75">{t("noPlans")}</p>
      ) : eligible.length === 0 ? null : (
        <div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--dashboard-shadow)] sm:p-6">
          <p className="max-w-prose text-sm leading-relaxed">{t("intro")}</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-[var(--navy)]">{t("student")}</span>
              <select value={studentId} onChange={(event) => setStudentId(event.target.value)} className="rounded-lg border border-[var(--line)] bg-white px-3 py-2">
                {eligible.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-[var(--navy)]">{t("plan")}</span>
              <select value={planId} onChange={(event) => setPlanId(event.target.value)} className="rounded-lg border border-[var(--line)] bg-white px-3 py-2">
                {plans.map((entry) => <option key={entry.id} value={entry.id}>{t("planOption", { plan: entry.name, sessions: entry.sessions, price: entry.priceLabel })}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-6">
            <p className="mb-3 text-sm font-medium text-[var(--navy)]">{t("calendarLabel")}</p>
            <ChargeDateRail dates={dates} locale={locale} firstLabel={t("today")} laterLabel={t("autoCharge", { price: plan?.priceLabel ?? "" })} />
            <p className="mt-3 text-xs opacity-70">{t("shortMonthNote")}</p>
          </div>
          <label className="mt-6 flex items-start gap-3 rounded-lg bg-[var(--background)] p-4 text-sm leading-relaxed">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--emerald)]" />
            <span>{t("consent", { price: plan?.priceLabel ?? "" })}</span>
          </label>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" disabled={!consent || busy || !studentId || !planId} onClick={() => void start()} className="cta-primary rounded-xl px-5 py-2.5 text-sm disabled:opacity-50">
              {t("start")}
            </button>
            <p className="text-xs opacity-70">{t("cancelAnyTime")}</p>
          </div>
          {message ? <p role="status" className="mt-3 text-sm opacity-80">{message}</p> : null}
        </div>
      )}
    </section>
  );
}
