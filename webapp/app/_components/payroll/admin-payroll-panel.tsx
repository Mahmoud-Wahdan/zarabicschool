"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import AdjustmentsLedger from "./adjustments-ledger";

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
  const [adjustment, setAdjustment] = useState({ teacherId: "", amountMinor: "", currency: "EGP", reason: "", category: "BONUS" });
  // S-12: the ledger list reloads after each new entry.
  const [ledgerVersion, setLedgerVersion] = useState(0);
  // D14: a fine takes money away, a bonus or overtime adds it — the Admin types the
  // amount and the category gives the sign; only "other" is typed with its sign.
  const signedAmount = (value: string, category: string) => {
    const amount = Number(value);
    if (category === "FINE") return -Math.abs(amount);
    if (category === "BONUS" || category === "OVERTIME") return Math.abs(amount);
    return amount;
  };
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
      <section className="z-card rounded-xl p-5">
        <h2 className="font-semibold text-primary">{t("ratesTitle")}</h2>
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
          <select required aria-label={t("teacherLabel")} value={rate.teacherId} onChange={(e) => setRate({ ...rate, teacherId: e.target.value })} className="z-input">
            <option value="">{t("teacherLabel")}</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>
            ))}
          </select>
          <input required type="number" min={1} value={rate.hourlyRateMinor} onChange={(e) => setRate({ ...rate, hourlyRateMinor: e.target.value })} placeholder={t("rateAmountLabel")} className="z-input" />
          <select aria-label={t("currencyLabel")} value={rate.currency} onChange={(e) => setRate({ ...rate, currency: e.target.value })} className="z-input">
            <option value="EGP">EGP</option>
            <option value="USD">USD</option>
          </select>
          <div className="flex gap-2">
            <input required type="datetime-local" value={rate.effectiveFrom} onChange={(e) => setRate({ ...rate, effectiveFrom: e.target.value })} aria-label={t("rateEffectiveLabel")} className="min-w-0 flex-1 z-input" />
            <button type="submit" disabled={busy} className="btn btn-primary disabled:opacity-50">{t("addRate")}</button>
          </div>
        </form>
      </section>

      <section className="z-card rounded-xl p-5">
        <h2 className="font-semibold text-primary">{t("adjustmentsTitle")}</h2>
        <p id="adjustment-sign-hint" className="mt-1 text-label-sm text-on-surface-variant">{adjustment.category === "FINE" ? t("signHintFine") : adjustment.category === "OTHER" ? t("amountSignedHint") : t("signHintAdd")}</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await post(
              "/api/payroll/adjustments",
              {
                teacherId: adjustment.teacherId,
                amountMinor: signedAmount(adjustment.amountMinor, adjustment.category),
                currency: adjustment.currency,
                category: adjustment.category,
                reason: adjustment.reason,
              },
              t("adjustmentCreated"),
              true,
            );
            if (ok) {
              setAdjustment({ ...adjustment, teacherId: "", amountMinor: "", reason: "" });
              setLedgerVersion((value) => value + 1);
            }
          }}
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <select required aria-label={t("teacherLabel")} value={adjustment.teacherId} onChange={(e) => setAdjustment({ ...adjustment, teacherId: e.target.value })} className="z-input">
            <option value="">{t("teacherLabel")}</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>
            ))}
          </select>
          <select aria-label={t("categoryLabel")} value={adjustment.category} onChange={(e) => setAdjustment({ ...adjustment, category: e.target.value })} className="z-input">
            {["BONUS", "FINE", "OVERTIME", "OTHER"].map((value) => <option key={value} value={value}>{t(`category.${value}`)}</option>)}
          </select>
          <input required type="number" min={adjustment.category === "OTHER" ? undefined : 1} value={adjustment.amountMinor} onChange={(e) => setAdjustment({ ...adjustment, amountMinor: e.target.value })} placeholder={adjustment.category === "OTHER" ? t("amountSignedPlaceholder") : t("colAmount")} aria-describedby="adjustment-sign-hint" className="z-input" />
          <select aria-label={t("currencyLabel")} value={adjustment.currency} onChange={(e) => setAdjustment({ ...adjustment, currency: e.target.value })} className="z-input">
            <option value="EGP">EGP</option>
            <option value="USD">USD</option>
          </select>
          <div className="flex gap-2">
            <input required minLength={2} value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} placeholder={t("reasonLabel")} className="min-w-0 flex-1 z-input" />
            <button type="submit" disabled={busy} className="btn btn-primary disabled:opacity-50">{t("submitAdjustment")}</button>
          </div>
        </form>
      </section>

      <AdjustmentsLedger timeZone={timeZone} refreshKey={ledgerVersion} />

      <section className="z-card rounded-xl p-5">
        <h2 className="font-semibold text-primary">{t("disbursementsTitle")}</h2>
        <p className="mt-1 text-label-sm text-on-surface-variant">{t("amountPositiveHint")}</p>
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
          <select required aria-label={t("teacherLabel")} value={disbursement.teacherId} onChange={(e) => setDisbursement({ ...disbursement, teacherId: e.target.value })} className="z-input">
            <option value="">{t("teacherLabel")}</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>
            ))}
          </select>
          <input required type="number" min={1} value={disbursement.amountMinor} onChange={(e) => setDisbursement({ ...disbursement, amountMinor: e.target.value })} placeholder={t("colAmount")} className="z-input" />
          <select aria-label={t("currencyLabel")} value={disbursement.currency} onChange={(e) => setDisbursement({ ...disbursement, currency: e.target.value })} className="z-input">
            <option value="EGP">EGP</option>
            <option value="USD">USD</option>
          </select>
          <div className="flex gap-2">
            <input required minLength={2} value={disbursement.reason} onChange={(e) => setDisbursement({ ...disbursement, reason: e.target.value })} placeholder={t("reasonLabel")} className="min-w-0 flex-1 z-input" />
            <button type="submit" disabled={busy} className="btn btn-primary disabled:opacity-50">{t("submitDisbursement")}</button>
          </div>
        </form>
        <p className="mt-3 text-label-sm text-on-surface-variant">{t("payoutNote")}</p>
      </section>

      {message ? <p role="status" className="text-body-sm text-on-surface-variant">{message}</p> : null}
    </div>
  );
}
