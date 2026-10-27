"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { wallClockInputToUtc } from "../../../lib/schedules/recurrence";

type TeacherOption = { id: string; displayName: string };

/**
 * Admin-only payroll mutations: effective-dated hourly rates, signed manual
 * adjustments, and payout records. Every entry lands in the append-only
 * PayrollLedger with the acting Admin as created_by — history is never edited.
 */
export default function AdminPayrollPanel({ teachers, timeZone }: { teachers: TeacherOption[]; timeZone: string }) {
  const t = useTranslations("payroll");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState({ teacherId: "", hourlyRateMinor: "", currency: "EGP", effectiveFrom: "" });
  const [adjustment, setAdjustment] = useState({ teacherId: "", amountMinor: "", currency: "EGP", reason: "" });
  const [disbursement, setDisbursement] = useState({ teacherId: "", amountMinor: "", currency: "EGP", reason: "" });

  // A5: one Idempotency-Key per distinct ledger entry. A retry of the SAME entry
  // (double click, network error) reuses the key, so the server never writes it
  // twice; changing any field starts a new key.
  const ledgerKeys = useRef(new Map<string, string>());
  function idempotencyKeyFor(url: string, body: unknown) {
    const fingerprint = `${url}|${JSON.stringify(body)}`;
    let key = ledgerKeys.current.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      ledgerKeys.current.set(fingerprint, key);
    }
    return { fingerprint, key };
  }

  async function post(url: string, body: unknown, successMessage: string, idempotent = false) {
    setMessage("");
    setBusy(true);
    const idem = idempotent ? idempotencyKeyFor(url, body) : null;
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (idem) headers["idempotency-key"] = idem.key;
      let response: Response;
      try {
        response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      } catch {
        // Network failure: the key is kept, so retrying the same entry is safe.
        setMessage("NETWORK_ERROR");
        return false;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error?.message ?? payload.error?.code ?? "ERROR");
        return false;
      }
      // Recorded: the next identical entry is a NEW payment and gets a new key.
      if (idem) ledgerKeys.current.delete(idem.fingerprint);
      setMessage(successMessage);
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="dashboard-card p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("ratesTitle")}</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await post(
              "/api/admin/teacher-rates",
              {
                teacherId: rate.teacherId,
                hourlyRateMinor: Number(rate.hourlyRateMinor),
                currency: rate.currency,
                // Read in the Admin's zone, not the browser's (Cairo time-input fix, 2026-10-27).
                effectiveFrom: rate.effectiveFrom ? wallClockInputToUtc(rate.effectiveFrom, timeZone).toISOString() : undefined,
              },
              t("rateCreated"),
            );
            if (ok) setRate({ ...rate, teacherId: "", hourlyRateMinor: "", effectiveFrom: "" });
          }}
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <select required value={rate.teacherId} onChange={(e) => setRate({ ...rate, teacherId: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2">
            <option value="">{t("teacherLabel")}</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>
            ))}
          </select>
          <input required type="number" min={1} value={rate.hourlyRateMinor} onChange={(e) => setRate({ ...rate, hourlyRateMinor: e.target.value })} placeholder={t("rateAmountLabel")} className="rounded-lg border border-[var(--line)] px-3 py-2" />
          <select value={rate.currency} onChange={(e) => setRate({ ...rate, currency: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2">
            <option value="EGP">EGP</option>
            <option value="USD">USD</option>
          </select>
          <div className="flex gap-2">
            <input required type="datetime-local" value={rate.effectiveFrom} onChange={(e) => setRate({ ...rate, effectiveFrom: e.target.value })} aria-label={t("rateEffectiveLabel")} className="min-w-0 flex-1 rounded-lg border border-[var(--line)] px-3 py-2" />
            <button type="submit" disabled={busy} className="cta-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50">{t("addRate")}</button>
          </div>
        </form>
      </section>

      <section className="dashboard-card p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("adjustmentsTitle")}</h2>
        <p className="mt-1 text-xs opacity-70">{t("amountSignedHint")}</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await post(
              "/api/payroll/adjustments",
              {
                teacherId: adjustment.teacherId,
                amountMinor: Number(adjustment.amountMinor),
                currency: adjustment.currency,
                reason: adjustment.reason,
              },
              t("adjustmentCreated"),
              true,
            );
            if (ok) setAdjustment({ ...adjustment, teacherId: "", amountMinor: "", reason: "" });
          }}
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <select required value={adjustment.teacherId} onChange={(e) => setAdjustment({ ...adjustment, teacherId: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2">
            <option value="">{t("teacherLabel")}</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>
            ))}
          </select>
          <input required type="number" value={adjustment.amountMinor} onChange={(e) => setAdjustment({ ...adjustment, amountMinor: e.target.value })} placeholder={t("colAmount")} className="rounded-lg border border-[var(--line)] px-3 py-2" />
          <select value={adjustment.currency} onChange={(e) => setAdjustment({ ...adjustment, currency: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2">
            <option value="EGP">EGP</option>
            <option value="USD">USD</option>
          </select>
          <div className="flex gap-2">
            <input required minLength={2} value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} placeholder={t("reasonLabel")} className="min-w-0 flex-1 rounded-lg border border-[var(--line)] px-3 py-2" />
            <button type="submit" disabled={busy} className="cta-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50">{t("submitAdjustment")}</button>
          </div>
        </form>
      </section>

      <section className="dashboard-card p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("disbursementsTitle")}</h2>
        <p className="mt-1 text-xs opacity-70">{t("amountPositiveHint")}</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await post(
              "/api/payroll/disbursements",
              {
                teacherId: disbursement.teacherId,
                amountMinor: Number(disbursement.amountMinor),
                currency: disbursement.currency,
                reason: disbursement.reason,
              },
              t("disbursementCreated"),
              true,
            );
            if (ok) setDisbursement({ ...disbursement, teacherId: "", amountMinor: "", reason: "" });
          }}
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <select required value={disbursement.teacherId} onChange={(e) => setDisbursement({ ...disbursement, teacherId: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2">
            <option value="">{t("teacherLabel")}</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>
            ))}
          </select>
          <input required type="number" min={1} value={disbursement.amountMinor} onChange={(e) => setDisbursement({ ...disbursement, amountMinor: e.target.value })} placeholder={t("colAmount")} className="rounded-lg border border-[var(--line)] px-3 py-2" />
          <select value={disbursement.currency} onChange={(e) => setDisbursement({ ...disbursement, currency: e.target.value })} className="rounded-lg border border-[var(--line)] px-3 py-2">
            <option value="EGP">EGP</option>
            <option value="USD">USD</option>
          </select>
          <div className="flex gap-2">
            <input required minLength={2} value={disbursement.reason} onChange={(e) => setDisbursement({ ...disbursement, reason: e.target.value })} placeholder={t("reasonLabel")} className="min-w-0 flex-1 rounded-lg border border-[var(--line)] px-3 py-2" />
            <button type="submit" disabled={busy} className="cta-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50">{t("submitDisbursement")}</button>
          </div>
        </form>
        <p className="mt-3 text-xs opacity-60">{t("payoutNote")}</p>
      </section>

      {message ? <p role="status" className="text-sm opacity-75">{message}</p> : null}
    </div>
  );
}
