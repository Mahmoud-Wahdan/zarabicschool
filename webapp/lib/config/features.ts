/**
 * Feature flags (A6, owner 2026-10-28). Read from the environment on the server; a
 * flag is ON only when its variable is exactly "true" (any case, trimmed), so a
 * missing or mistyped value keeps the feature hidden.
 *
 * FEATURE_AUTO_RENEWAL — automatic monthly renewal (S-RENEW) for payers: the
 * "monthly auto-renewal" section on the guardian / adult-student invoices pages and
 * the sign-up API. OFF until one Paymob test-mode sign-up, renewal and refund have
 * been verified (Paymob dashboard access pending).
 */
type Env = Record<string, string | undefined>;

const on = (value: string | undefined) => value?.trim().toLowerCase() === "true";

export function isAutoRenewalEnabled(env: Env = process.env): boolean {
  return on(env.FEATURE_AUTO_RENEWAL);
}
