import "server-only";

import { Prisma } from "../../generated/prisma/client";

import { writePaymentAudit } from "../payments/audit";
import { PaymobSubscriptionClient, type PaymobRecord } from "../payments/paymob-subscriptions";
import { PaymentProviderError } from "../payments/types";
import { prisma } from "../prisma";
import { wallClockInputToUtc } from "../schedules/recurrence";
import { nextPeriodAfter, type RenewalPeriod } from "./renewal-dates";

/**
 * Automatic monthly renewal (D44, D51-D58; docs/specs/slices/S-RENEW-automatic-renewal.md).
 *
 * The subscription callback signs only the trigger and the subscription id, so money
 * moves ONLY from transactions the platform re-fetches from Paymob: a SUCCESS with
 * api_source SUBSCRIPTION, this subscription as source, the locked amount and the
 * currency. Each one books ONE PAID invoice for the period that contains it (S-7
 * unique indexes: one per period, one per Paymob transaction), a monthly package
 * with the plan's sessions and its INITIAL_PURCHASE entry, then moves the period and
 * sets Paymob's next_billing to the next same-day date (D56). Anything unclear is an
 * Admin flag and moves no money. Ids and reason codes only in jobs and logs.
 */
export type RenewalClient = Pick<PaymobSubscriptionClient, "listTransactions" | "updateNextBilling" | "cancel">;

export type RenewalDeps = { client?: RenewalClient; now?: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
export const RENEWAL_GRACE_DAYS = 3;
/** A charge may land up to this long before the period end (Paymob's 30-day count drifts). */
const EARLY_CHARGE_MS = 3 * DAY_MS;
/** Grace is detected only after Paymob had the night to charge (D58 starts it at period end). */
const DETECTION_DELAY_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TIME_ZONE = "Africa/Cairo";

type Db = Prisma.TransactionClient | typeof prisma;

function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002";
}

async function notify(db: Db, academyId: string, recipientUserId: string, kind: string, dedupKey: string, payload: Prisma.InputJsonValue) {
  await db.notificationJob.createMany({
    data: [{ academyId, sessionId: null, recipientUserId, kind, dedupKey, scheduledFor: new Date(), payload }],
    skipDuplicates: true,
  });
}

async function notifyAdmins(db: Db, academyId: string, kind: string, dedupBase: string, payload: Prisma.InputJsonValue) {
  const admins = await db.user.findMany({ where: { academyId, role: "ADMIN", isActive: true }, select: { id: true } });
  for (const admin of admins) await notify(db, academyId, admin.id, kind, `${dedupBase}:${admin.id}`, payload);
}

function flagAnomaly(db: Db, academyId: string, billingSubscriptionId: string, reason: string, transactionId: string) {
  return notifyAdmins(db, academyId, "PAYMENT_ANOMALY", `PAYMENT_ANOMALY:RENEWAL:${transactionId}:${reason}`, { reason, billingSubscriptionId });
}

type Charge = { id: string; outcome: "SUCCESS" | "PENDING" | "FAILED"; amountMinor: bigint | null; currency: string; sourceId: string | null; apiSource: string; chargedAt: Date | null };

/**
 * Paymob's `created_at` has no offset; the published renewal sample charged at 00:01
 * on the billing date, so a bare timestamp is read as Africa/Cairo wall time (NOT
 * DOCUMENTED by Paymob — confirm in the test-mode run). An explicit offset wins.
 */
function parseChargedAt(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return wallClockInputToUtc(value.slice(0, 16), DEFAULT_TIME_ZONE);
}

function readCharge(txn: PaymobRecord): Charge | null {
  const id = typeof txn.id === "number" || typeof txn.id === "string" ? String(txn.id) : "";
  if (!/^\d{1,20}$/.test(id)) return null;
  const amount = typeof txn.amount_cents === "number" && Number.isSafeInteger(txn.amount_cents) ? BigInt(txn.amount_cents) : null;
  const success =
    txn.success === true &&
    txn.pending !== true &&
    txn.error_occured !== true &&
    txn.is_voided !== true &&
    txn.is_refunded !== true &&
    txn.is_void !== true &&
    txn.is_refund !== true &&
    !(txn.is_auth === true && txn.is_capture !== true);
  return {
    id,
    outcome: txn.pending === true ? "PENDING" : success ? "SUCCESS" : "FAILED",
    amountMinor: amount,
    currency: typeof txn.currency === "string" ? txn.currency : "",
    sourceId: txn.source_id === undefined || txn.source_id === null ? null : String(txn.source_id),
    apiSource: typeof txn.api_source === "string" ? txn.api_source : "",
    chargedAt: parseChargedAt(txn.created_at),
  };
}

/** The anchor-date period that contains `chargedAt`, starting from the current period end. */
function periodContaining(currentPeriodEnd: Date, anchorDay: number, chargedAt: Date, timeZone: string): RenewalPeriod {
  let period = nextPeriodAfter(currentPeriodEnd, anchorDay, timeZone);
  while (period.end.getTime() <= chargedAt.getTime()) period = nextPeriodAfter(period.end, anchorDay, timeZone);
  return period;
}

type BookResult = { status: "booked"; period: RenewalPeriod } | { status: "already" } | { status: "refused"; reason: string } | { status: "skipped" };

async function bookRenewal(billingSubscriptionId: string, charge: Charge): Promise<BookResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<BookResult> => {
      await tx.$queryRaw`SELECT id FROM billing_subscriptions WHERE id = ${billingSubscriptionId}::uuid FOR UPDATE`;
      const sub = await tx.billingSubscription.findUniqueOrThrow({
        where: { id: billingSubscriptionId },
        include: { plan: true, payerUser: { select: { timezone: true } } },
      });
      const known = await tx.invoice.findFirst({ where: { provider: "PAYMOB", providerReference: charge.id, billingSubscriptionId: { not: null } }, select: { id: true } });
      if (known) return { status: "already" };
      const chargedAt = charge.chargedAt!;
      // History (the sign-up payment, earlier cycles) is never booked again.
      if (chargedAt.getTime() < sub.currentPeriodStart.getTime()) return { status: "skipped" };
      const refuse = async (reason: string): Promise<BookResult> => {
        await flagAnomaly(tx, sub.academyId, sub.id, reason, charge.id);
        return { status: "refused", reason };
      };
      if (!sub.autoRenew || sub.status === "CANCELED") return refuse("RENEWAL_AFTER_CANCEL");
      if (sub.plan.packageType !== "MONTHLY_PLAN") return refuse("RENEWAL_PLAN_NOT_MONTHLY");
      if (charge.currency !== sub.currency) return refuse("RENEWAL_CURRENCY_MISMATCH");
      if (charge.amountMinor === null || charge.amountMinor !== sub.lockedPriceMinor) return refuse("RENEWAL_AMOUNT_MISMATCH");
      if (!sub.billingAnchorDay) return refuse("RENEWAL_NO_ANCHOR_DAY");
      if (chargedAt.getTime() < sub.currentPeriodEnd.getTime() - EARLY_CHARGE_MS) return refuse("RENEWAL_UNEXPECTED_TIMING");

      const timeZone = sub.payerUser.timezone || DEFAULT_TIME_ZONE;
      const period = periodContaining(sub.currentPeriodEnd, sub.billingAnchorDay, chargedAt, timeZone);
      const pkg = await tx.subscription.create({
        data: {
          academyId: sub.academyId,
          studentId: sub.studentId,
          packageType: "MONTHLY_PLAN",
          sessionsPurchased: sub.plan.sessionsPerMonth,
          totalAmountMinor: charge.amountMinor,
          currency: sub.currency,
          periodStartsAt: period.start,
          periodEndsAt: period.end,
          status: "ACTIVE",
        },
      });
      const invoice = await tx.invoice.create({
        data: {
          academyId: sub.academyId,
          studentId: sub.studentId,
          subscriptionId: pkg.id,
          amountMinor: charge.amountMinor,
          currency: sub.currency,
          provider: "PAYMOB",
          packageType: "MONTHLY_PLAN",
          sessionsPurchased: sub.plan.sessionsPerMonth,
          status: "PAID",
          providerReference: charge.id,
          paidAt: chargedAt,
          billingSubscriptionId: sub.id,
          billingPeriodStart: new Date(`${period.startDate}T00:00:00Z`),
        },
      });
      await tx.subscriptionLedger.create({
        data: { academyId: sub.academyId, subscriptionId: pkg.id, invoiceId: invoice.id, entryType: "INITIAL_PURCHASE", sessionsDelta: sub.plan.sessionsPerMonth },
      });
      await tx.billingSubscription.update({
        where: { id: sub.id },
        data: { currentPeriodStart: period.start, currentPeriodEnd: period.end, status: "ACTIVE", graceEndsAt: null },
      });
      // PAID commits with the money move (fail-closed, like the sign-up settlement).
      await writePaymentAudit({
        academyId: sub.academyId,
        invoiceId: invoice.id,
        eventType: "PAID",
        actorId: null,
        actorRole: "WEBHOOK",
        metadata: { provider: "PAYMOB", providerReference: charge.id, amountMinor: charge.amountMinor.toString(), currency: sub.currency, packageType: "MONTHLY_PLAN", sessionsPurchased: sub.plan.sessionsPerMonth, reason: "RENEWAL" },
      }, tx);
      await notify(tx, sub.academyId, sub.payerUserId, "RENEWAL_PAID", `RENEWAL_PAID:${charge.id}:${sub.payerUserId}`, { billingSubscriptionId: sub.id, invoiceId: invoice.id });
      return { status: "booked", period };
    });
  } catch (cause) {
    // A concurrent sweep booked the same transaction or period first (S-7 indexes).
    if (isUniqueViolation(cause)) return { status: "already" };
    throw cause;
  }
}

export type SweepResult = { booked: number };

/** Re-fetch one subscription's transactions from Paymob and book what is verified. */
export async function sweepBillingSubscription(billingSubscriptionId: string, deps: RenewalDeps = {}): Promise<SweepResult> {
  const client = deps.client ?? new PaymobSubscriptionClient();
  const sub = await prisma.billingSubscription.findUnique({
    where: { id: billingSubscriptionId },
    select: { id: true, academyId: true, payerUserId: true, providerSubscriptionId: true, currentPeriodStart: true },
  });
  if (!sub?.providerSubscriptionId) return { booked: 0 };
  const providerSubscriptionId = sub.providerSubscriptionId;
  const charges = (await client.listTransactions(providerSubscriptionId))
    .map(readCharge)
    .filter((charge): charge is Charge => charge !== null && charge.apiSource === "SUBSCRIPTION" && charge.chargedAt !== null)
    .sort((a, b) => a.chargedAt!.getTime() - b.chargedAt!.getTime());
  let booked = 0;
  for (const charge of charges) {
    if (charge.sourceId !== null && charge.sourceId !== providerSubscriptionId) {
      await flagAnomaly(prisma, sub.academyId, sub.id, "RENEWAL_SOURCE_MISMATCH", charge.id);
      continue;
    }
    if (charge.outcome === "PENDING") continue;
    if (charge.outcome === "FAILED") {
      // D51: the payer hears about a failed charge of the current cycle, once per transaction.
      if (charge.chargedAt!.getTime() >= sub.currentPeriodStart.getTime()) {
        await notify(prisma, sub.academyId, sub.payerUserId, "RENEWAL_FAILED", `RENEWAL_FAILED:${charge.id}:${sub.payerUserId}`, { billingSubscriptionId: sub.id });
      }
      continue;
    }
    const result = await bookRenewal(sub.id, charge);
    if (result.status !== "booked") continue;
    booked += 1;
    try {
      await client.updateNextBilling(providerSubscriptionId, result.period.nextBilling);
    } catch {
      // The booking stands; Paymob's own 30-day date applies until a later sweep or
      // the Admin fixes it.
      await flagAnomaly(prisma, sub.academyId, sub.id, "NEXT_BILLING_UPDATE_FAILED", charge.id);
    }
  }
  return { booked };
}

const lastSweepAt = new Map<string, number>();

/**
 * Worker step: sweep every renewing subscription whose period has ended (at most every
 * `sweepIntervalMs` each), then apply D58 grace and D52 period-end cancellation.
 */
export async function processRenewals(now = new Date(), options: { client?: RenewalClient; academyId?: string; sweepIntervalMs?: number } = {}) {
  const interval = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const due = await prisma.billingSubscription.findMany({
    where: {
      status: { in: ["ACTIVE", "PAST_DUE"] },
      providerSubscriptionId: { not: null },
      currentPeriodEnd: { lte: now },
      ...(options.academyId ? { academyId: options.academyId } : {}),
    },
    orderBy: { currentPeriodEnd: "asc" },
    take: 100,
    select: { id: true, academyId: true, payerUserId: true, autoRenew: true, currentPeriodEnd: true },
  });
  let client = options.client;
  for (const sub of due) {
    try {
      if (!sub.autoRenew) {
        // D52: cancelled earlier, the paid period has now ended.
        await prisma.billingSubscription.updateMany({ where: { id: sub.id, autoRenew: false, currentPeriodEnd: { lte: now } }, data: { status: "CANCELED" } });
        continue;
      }
      if (now.getTime() < sub.currentPeriodEnd.getTime() + DETECTION_DELAY_MS) continue;
      const last = lastSweepAt.get(sub.id);
      if (last === undefined || now.getTime() - last >= interval) {
        client ??= new PaymobSubscriptionClient();
        await sweepBillingSubscription(sub.id, { client, now });
        lastSweepAt.set(sub.id, now.getTime());
      }
      const graceEndsAt = new Date(sub.currentPeriodEnd.getTime() + RENEWAL_GRACE_DAYS * DAY_MS);
      const marked = await prisma.billingSubscription.updateMany({
        where: { id: sub.id, status: "ACTIVE", autoRenew: true, currentPeriodEnd: sub.currentPeriodEnd },
        data: { status: "PAST_DUE", graceEndsAt },
      });
      if (marked.count === 1) {
        const dedup = `${sub.id}:${sub.currentPeriodEnd.toISOString()}`;
        const payload = { billingSubscriptionId: sub.id };
        await notify(prisma, sub.academyId, sub.payerUserId, "RENEWAL_PAST_DUE", `RENEWAL_PAST_DUE:${dedup}:${sub.payerUserId}`, payload);
        await notifyAdmins(prisma, sub.academyId, "RENEWAL_PAST_DUE_ADMIN", `RENEWAL_PAST_DUE_ADMIN:${dedup}`, payload);
      }
    } catch (cause) {
      // Paymob unreachable or not configured: nothing is marked past due this tick.
      const code = cause instanceof PaymentProviderError ? cause.code : "ERROR";
      console.error(`[renewal] subscription ${sub.id} skipped this tick (${code}).`);
    }
  }
}

/** D52: stop automatic renewal; Paymob is cancelled FIRST, the paid period stays usable. */
export async function cancelAutoRenewal(billingSubscriptionId: string, deps: { client?: RenewalClient; actorUserId: string }) {
  const sub = await prisma.billingSubscription.findUniqueOrThrow({
    where: { id: billingSubscriptionId },
    select: { id: true, academyId: true, payerUserId: true, status: true, autoRenew: true, providerSubscriptionId: true, currentPeriodEnd: true },
  });
  if (sub.status === "CANCELED" || !sub.autoRenew) return { status: "already_cancelled" as const, periodEnd: sub.currentPeriodEnd };
  if (sub.providerSubscriptionId) await (deps.client ?? new PaymobSubscriptionClient()).cancel(sub.providerSubscriptionId);
  const now = new Date();
  await prisma.billingSubscription.update({
    where: { id: sub.id },
    // A past-due subscription has no paid period left to keep.
    data: { autoRenew: false, canceledAt: now, ...(sub.status === "PAST_DUE" ? { status: "CANCELED" } : {}) },
  });
  await notify(prisma, sub.academyId, sub.payerUserId, "RENEWAL_CANCELLED", `RENEWAL_CANCELLED:${sub.id}:${sub.payerUserId}`, { billingSubscriptionId: sub.id });
  if (deps.actorUserId !== sub.payerUserId) {
    await notifyAdmins(prisma, sub.academyId, "RENEWAL_CANCELLED_ADMIN", `RENEWAL_CANCELLED_ADMIN:${sub.id}`, { billingSubscriptionId: sub.id });
  }
  return { status: "cancel_scheduled" as const, periodEnd: sub.currentPeriodEnd };
}

const RENEWAL_TRIGGERS = new Set(["Successful Transaction", "Failed Transaction", "Failed Overdue Transaction"]);

/** A verified subscription callback is only a trigger (the HMAC covers trigger + id only). */
export async function handleSubscriptionCallback(event: { triggerType: string; providerSubscriptionId: string }, deps: RenewalDeps = {}) {
  const sub = await prisma.billingSubscription.findUnique({
    where: { providerSubscriptionId: event.providerSubscriptionId },
    select: { id: true, academyId: true, autoRenew: true },
  });
  if (!sub) return { status: "unmatched" as const };
  if (RENEWAL_TRIGGERS.has(event.triggerType)) {
    const result = await sweepBillingSubscription(sub.id, deps);
    lastSweepAt.set(sub.id, (deps.now ?? new Date()).getTime());
    return { status: "swept" as const, booked: result.booked };
  }
  if (event.triggerType === "canceled") {
    // Paymob says it will not charge again (state cannot be trusted beyond that):
    // stop renewing, keep the paid period (D52).
    if (sub.autoRenew) await prisma.billingSubscription.update({ where: { id: sub.id }, data: { autoRenew: false, canceledAt: new Date() } });
    return { status: "cancel_recorded" as const };
  }
  if (event.triggerType === "suspended") {
    await notifyAdmins(prisma, sub.academyId, "PAYMENT_ANOMALY", `PAYMENT_ANOMALY:SUSPENDED:${sub.id}:${new Date().toISOString().slice(0, 10)}`, { reason: "SUBSCRIPTION_SUSPENDED", billingSubscriptionId: sub.id });
    return { status: "flagged" as const };
  }
  return { status: "ignored" as const };
}
