import { prisma } from "../prisma";

let phase6bReady = false;
let warnedMissing = false;

/**
 * Phase 6b additions (BillingPlans, ExchangeRates, BillingSubscriptions, WebhookEvents)
 * arrive with migration 20261020000000_phase6b_subscriptions_and_plans, which the
 * OWNER applies (Phase 3/4/5 pattern).
 *
 * Checks if the billing_plans table exists in information_schema.
 * Only positive results are cached for self-healing once applied.
 */
export async function isPhase6bReady(): Promise<boolean> {
  if (phase6bReady) return true;
  try {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'billing_plans'",
    )) as { count: number }[];
    phase6bReady = rows[0]?.count === 1;
    if (!phase6bReady && !warnedMissing) {
      warnedMissing = true;
      console.warn(
        "[phase6b] migration 20261020000000_phase6b_subscriptions_and_plans is pending — billing plan management, exchange rates, and billing subscriptions degrade safely until the owner applies it.",
      );
    }
  } catch {
    return false;
  }
  return phase6bReady;
}
