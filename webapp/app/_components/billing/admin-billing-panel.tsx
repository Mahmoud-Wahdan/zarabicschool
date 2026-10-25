"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export type BillingPlanRow = {
  id: string;
  nameAr: string;
  nameEn: string;
  packageType: "MONTHLY_PLAN" | "ANNUAL_PLAN";
  sessionsPerMonth: number;
  basePriceMinor: string;
  currency: string;
  tier: string | null;
  isActive: boolean;
  activeSubscribersCount: number;
};

/**
 * Admin-only billing mutations (Phase 6b — B7): create plans, activate/deactivate
 * them, update plan prices (new subscriptions only — existing subscribers keep
 * their locked price), set the effective exchange rate, and configure the
 * pay-per-session min/max. All money is integer minor units; the server validates
 * everything again. USD checkout itself stays disabled until the owner resolves
 * the Dodo-vs-Xpay decision — this panel never implies a configured provider.
 */
export default function AdminBillingPanel({
  plans,
  migrationPending,
  payPerSession,
}: {
  plans: BillingPlanRow[];
  migrationPending: boolean;
  payPerSession: { minSessions: number; maxSessions: number };
}) {
  const t = useTranslations("billingAdmin");
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [planForm, setPlanForm] = useState({
    nameAr: "",
    nameEn: "",
    packageType: "MONTHLY_PLAN" as "MONTHLY_PLAN" | "ANNUAL_PLAN",
    sessionsPerMonth: "",
    basePriceMinor: "",
    currency: "EGP",
    tier: "",
  });
  const [rateForm, setRateForm] = useState({ fromCurrency: "", toCurrency: "", rate: "" });
  const [ppsForm, setPpsForm] = useState({
    minSessions: String(payPerSession.minSessions),
    maxSessions: String(payPerSession.maxSessions),
  });
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});

  async function send(url: string, method: string, body: unknown): Promise<boolean> {
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error?.message ?? t("actionFailed"));
        return false;
      }
      setMessage(t("created"));
      router.refresh();
      return true;
    } catch {
      setMessage(t("actionFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="z-card flex flex-col gap-4 rounded-xl p-4 sm:p-6">
        <h2 className="text-headline-sm font-bold text-primary">{t("createPlanTitle")}</h2>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (migrationPending) return;
            const sessions = Number(planForm.sessionsPerMonth);
            const price = Number(planForm.basePriceMinor);
            if (!planForm.nameAr || !planForm.nameEn || !Number.isSafeInteger(sessions) || sessions <= 0 || !Number.isSafeInteger(price) || price <= 0) {
              setMessage(t("invalidForm"));
              return;
            }
            const ok = await send("/api/admin/billing/plans", "POST", {
              nameAr: planForm.nameAr,
              nameEn: planForm.nameEn,
              packageType: planForm.packageType,
              sessionsPerMonth: sessions,
              basePriceMinor: price,
              currency: planForm.currency,
              tier: planForm.tier || undefined,
            });
            if (ok) {
              setPlanForm({ nameAr: "", nameEn: "", packageType: "MONTHLY_PLAN", sessionsPerMonth: "", basePriceMinor: "", currency: "EGP", tier: "" });
            }
          }}
        >
          <label className="flex flex-col gap-1 text-body-sm">
            <span className="font-medium">{t("fieldNameAr")}</span>
            <input
              className="z-input"
              value={planForm.nameAr}
              onChange={(event) => setPlanForm((current) => ({ ...current, nameAr: event.target.value }))}
              disabled={busy || migrationPending}
              dir="rtl"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-body-sm">
            <span className="font-medium">{t("fieldNameEn")}</span>
            <input
              className="z-input"
              value={planForm.nameEn}
              onChange={(event) => setPlanForm((current) => ({ ...current, nameEn: event.target.value }))}
              disabled={busy || migrationPending}
              dir="ltr"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-body-sm">
            <span className="font-medium">{t("fieldPackageType")}</span>
            <select
              className="z-input"
              value={planForm.packageType}
              onChange={(event) => setPlanForm((current) => ({ ...current, packageType: event.target.value as "MONTHLY_PLAN" | "ANNUAL_PLAN" }))}
              disabled={busy || migrationPending}
            >
              <option value="MONTHLY_PLAN">{t("packageMonthly")}</option>
              <option value="ANNUAL_PLAN">{t("packageAnnual")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-body-sm">
            <span className="font-medium">{t("fieldSessionsPerMonth")}</span>
            <input
              className="z-input"
              type="number"
              min={1}
              value={planForm.sessionsPerMonth}
              onChange={(event) => setPlanForm((current) => ({ ...current, sessionsPerMonth: event.target.value }))}
              disabled={busy || migrationPending}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-body-sm">
            <span className="font-medium">{t("fieldBasePrice")}</span>
            <input
              className="z-input"
              type="number"
              min={1}
              step={1}
              value={planForm.basePriceMinor}
              onChange={(event) => setPlanForm((current) => ({ ...current, basePriceMinor: event.target.value }))}
              disabled={busy || migrationPending}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-body-sm">
            <span className="font-medium">{t("fieldCurrency")}</span>
            <select
              className="z-input"
              value={planForm.currency}
              onChange={(event) => setPlanForm((current) => ({ ...current, currency: event.target.value }))}
              disabled={busy || migrationPending}
            >
              <option value="EGP">EGP</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-body-sm">
            <span className="font-medium">{t("fieldTier")}</span>
            <input
              className="z-input"
              value={planForm.tier}
              onChange={(event) => setPlanForm((current) => ({ ...current, tier: event.target.value }))}
              disabled={busy || migrationPending}
            />
          </label>
          <button type="submit" className="btn-primary self-end" disabled={busy || migrationPending}>
            {t("createPlan")}
          </button>
        </form>
      </section>

      {plans.length > 0 && (
        <section className="z-card flex flex-col gap-4 rounded-xl p-4 sm:p-6">
          <h2 className="text-headline-sm font-bold text-primary">{t("plansTitle")}</h2>
          <p className="text-body-sm text-on-surface-variant">{t("plansHint")}</p>
          <div className="overflow-x-auto">
            <table className="z-table min-w-[760px]">
              <thead>
                <tr>
                  <th scope="col">{t("colName")}</th>
                  <th scope="col">{t("colPackage")}</th>
                  <th scope="col">{t("colSessions")}</th>
                  <th scope="col">{t("colPrice")}</th>
                  <th scope="col">{t("colSubscribers")}</th>
                  <th scope="col">{t("colStatus")}</th>
                  <th scope="col">{t("colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <td className="font-semibold">
                      <span dir="rtl">{plan.nameAr}</span>
                      <span className="block text-body-xs text-on-surface-variant" dir="ltr">{plan.nameEn}</span>
                    </td>
                    <td>{plan.packageType === "ANNUAL_PLAN" ? t("packageAnnual") : t("packageMonthly")}</td>
                    <td>{plan.sessionsPerMonth}</td>
                    <td className="font-semibold">
                      {new Intl.NumberFormat("en-GB", { style: "currency", currency: plan.currency, currencyDisplay: "narrowSymbol" }).format(Number(plan.basePriceMinor) / 100)}
                    </td>
                    <td>{plan.activeSubscribersCount}</td>
                    <td>{plan.isActive ? t("statusActive") : t("statusInactive")}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="btn-soft"
                          disabled={busy || migrationPending}
                          onClick={() => send(`/api/admin/billing/plans/${plan.id}`, "PATCH", { isActive: !plan.isActive })}
                        >
                          {plan.isActive ? t("actionToggleInactive") : t("actionToggleActive")}
                        </button>
                        <input
                          className="z-input w-32"
                          type="number"
                          min={1}
                          step={1}
                          placeholder={t("actionNewPrice")}
                          value={priceEdits[plan.id] ?? ""}
                          onChange={(event) => setPriceEdits((current) => ({ ...current, [plan.id]: event.target.value }))}
                          disabled={busy || migrationPending}
                          aria-label={t("actionNewPrice")}
                        />
                        <button
                          type="button"
                          className="btn-soft"
                          disabled={busy || migrationPending}
                          onClick={async () => {
                            const price = Number(priceEdits[plan.id]);
                            if (!Number.isSafeInteger(price) || price <= 0) {
                              setMessage(t("invalidForm"));
                              return;
                            }
                            const ok = await send(`/api/admin/billing/plans/${plan.id}`, "PATCH", { basePriceMinor: price });
                            if (ok) setPriceEdits((current) => ({ ...current, [plan.id]: "" }));
                          }}
                        >
                          {t("actionSavePrice")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="z-card flex flex-col gap-4 rounded-xl p-4 sm:p-6">
        <h2 className="text-headline-sm font-bold text-primary">{t("setRateTitle")}</h2>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (migrationPending) return;
            const rate = Number(rateForm.rate);
            if (!rateForm.fromCurrency || !rateForm.toCurrency || !(rate > 0)) {
              setMessage(t("invalidForm"));
              return;
            }
            const ok = await send("/api/admin/billing/exchange-rates", "POST", {
              fromCurrency: rateForm.fromCurrency,
              toCurrency: rateForm.toCurrency,
              rate,
            });
            if (ok) setRateForm({ fromCurrency: "", toCurrency: "", rate: "" });
          }}
        >
          <label className="flex flex-col gap-1 text-body-sm">
            <span className="font-medium">{t("fieldFromCurrency")}</span>
            <input
              className="z-input"
              maxLength={3}
              value={rateForm.fromCurrency}
              onChange={(event) => setRateForm((current) => ({ ...current, fromCurrency: event.target.value.toUpperCase() }))}
              disabled={busy || migrationPending}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-body-sm">
            <span className="font-medium">{t("fieldToCurrency")}</span>
            <input
              className="z-input"
              maxLength={3}
              value={rateForm.toCurrency}
              onChange={(event) => setRateForm((current) => ({ ...current, toCurrency: event.target.value.toUpperCase() }))}
              disabled={busy || migrationPending}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-body-sm">
            <span className="font-medium">{t("fieldRate")}</span>
            <input
              className="z-input"
              type="number"
              min={0}
              step="any"
              value={rateForm.rate}
              onChange={(event) => setRateForm((current) => ({ ...current, rate: event.target.value }))}
              disabled={busy || migrationPending}
              required
            />
          </label>
          <button type="submit" className="btn-primary self-end" disabled={busy || migrationPending}>
            {t("setRate")}
          </button>
        </form>
      </section>

      <section className="z-card flex flex-col gap-4 rounded-xl p-4 sm:p-6">
        <h2 className="text-headline-sm font-bold text-primary">{t("payPerSessionTitle")}</h2>
        <p className="text-body-sm text-on-surface-variant">{t("payPerSessionHint")}</p>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const minSessions = Number(ppsForm.minSessions);
            const maxSessions = Number(ppsForm.maxSessions);
            if (!Number.isSafeInteger(minSessions) || !Number.isSafeInteger(maxSessions) || minSessions < 1 || maxSessions < 1) {
              setMessage(t("invalidForm"));
              return;
            }
            await send("/api/admin/billing/settings/pay-per-session", "POST", { minSessions, maxSessions });
          }}
        >
          <label className="flex flex-col gap-1 text-body-sm">
            <span className="font-medium">{t("fieldMinSessions")}</span>
            <input
              className="z-input"
              type="number"
              min={1}
              value={ppsForm.minSessions}
              onChange={(event) => setPpsForm((current) => ({ ...current, minSessions: event.target.value }))}
              disabled={busy}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-body-sm">
            <span className="font-medium">{t("fieldMaxSessions")}</span>
            <input
              className="z-input"
              type="number"
              min={1}
              value={ppsForm.maxSessions}
              onChange={(event) => setPpsForm((current) => ({ ...current, maxSessions: event.target.value }))}
              disabled={busy}
              required
            />
          </label>
          <button type="submit" className="btn-primary self-end" disabled={busy}>
            {t("savePayPerSession")}
          </button>
        </form>
      </section>

      {message && (
        <p className="text-body-sm font-medium text-on-surface-variant" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
