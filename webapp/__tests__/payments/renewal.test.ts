import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  cancelAutoRenewal,
  handleSubscriptionCallback,
  processRenewals,
  sweepBillingSubscription,
  type RenewalClient,
} from "../../lib/billing/renewal";
import { composeJobMessage } from "../../lib/worker/notifications";
import { prisma } from "../../lib/prisma";
import { PaymentProviderError } from "../../lib/payments/types";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Automatic renewal (D44, D51-D58; docs/specs/slices/S-RENEW-automatic-renewal.md).
 * Paymob is replaced by a fake subscription client; the database is the real dev DB
 * inside a per-run test academy only. Money moves only for a re-fetched SUCCESS
 * transaction with api_source SUBSCRIPTION, this subscription as source, the locked
 * amount and currency.
 */
jest.setTimeout(240_000);

const PRICE = BigInt(100000);
let fx: SessionFixtures;
let planId: string;

class FakeClient implements RenewalClient {
  transactions: Record<string, unknown>[] = [];
  nextBilling: [string, string][] = [];
  cancelled: string[] = [];
  failCancel = false;
  failList = false;
  async listTransactions(id: string) {
    if (this.failList) throw new PaymentProviderError("down", "UPSTREAM_ERROR");
    return this.transactions.filter((txn) => String(txn.source_id) === id || txn.source_id === undefined);
  }
  async updateNextBilling(id: string, date: string) {
    this.nextBilling.push([id, date]);
    return {};
  }
  async cancel(id: string) {
    if (this.failCancel) throw new PaymentProviderError("no", "UPSTREAM_ERROR");
    this.cancelled.push(id);
    return { state: "canceled" };
  }
}

const NOV_10 = new Date("2026-11-09T22:00:00Z"); // 10 Nov 00:00 Cairo

function txn(providerSubId: string, over: Record<string, unknown> = {}) {
  return {
    id: randomInt(100_000_000, 999_999_999),
    order: randomInt(100_000_000, 999_999_999),
    amount_cents: Number(PRICE),
    currency: "EGP",
    success: true,
    pending: false,
    error_occured: false,
    is_voided: false,
    is_refunded: false,
    is_auth: false,
    is_capture: false,
    api_source: "SUBSCRIPTION",
    source_id: Number(providerSubId),
    created_at: "2026-11-10T00:01:51.305855", // Cairo wall time, as in Paymob's sample
    ...over,
  };
}

async function billingSubscription(studentKey: string, over: Record<string, unknown> = {}) {
  const providerSubscriptionId = String(randomInt(1_000_000, 2_000_000_000));
  const row = await prisma.billingSubscription.create({
    data: {
      academyId: fx.academyId,
      studentId: fx.studentProfileIds[studentKey],
      payerUserId: fx.guardianUserId,
      planId,
      currency: "EGP",
      status: "ACTIVE",
      providerSubscriptionId,
      lockedPriceMinor: PRICE,
      currentPeriodStart: new Date("2026-10-10T12:00:00Z"),
      currentPeriodEnd: NOV_10,
      billingAnchorDay: 10,
      ...over,
    },
  });
  return row;
}

const jobs = (kind: string) => prisma.notificationJob.findMany({ where: { academyId: fx.academyId, kind } });
const renewalInvoices = (billingSubscriptionId: string) =>
  prisma.invoice.findMany({ where: { billingSubscriptionId }, orderBy: { billingPeriodStart: "asc" } });

beforeAll(async () => {
  fx = await createSessionFixtures();
  const plan = await prisma.billingPlan.create({
    data: {
      academyId: fx.academyId, nameAr: "شهري", nameEn: "Monthly", packageType: "MONTHLY_PLAN",
      sessionsPerMonth: 8, basePriceMinor: PRICE, currency: "EGP", providerPlanId: String(randomInt(1_000_000, 2_000_000_000)),
    },
  });
  planId = plan.id;
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("automatic renewal", () => {
  it("RN-01: a re-fetched paid renewal books one PAID invoice for the next period, a package with the plan's sessions, moves the period, sets next_billing and tells the payer", async () => {
    const sub = await billingSubscription("student1");
    const client = new FakeClient();
    const charge = txn(sub.providerSubscriptionId!);
    client.transactions.push(charge);
    const result = await sweepBillingSubscription(sub.id, { client, now: new Date("2026-11-10T08:00:00Z") });
    expect(result.booked).toBe(1);

    const [invoice] = await renewalInvoices(sub.id);
    expect(invoice).toMatchObject({ status: "PAID", provider: "PAYMOB", providerReference: String(charge.id), amountMinor: PRICE, packageType: "MONTHLY_PLAN", sessionsPurchased: 8 });
    expect(invoice.billingPeriodStart?.toISOString().slice(0, 10)).toBe("2026-11-10");
    const pkg = await prisma.subscription.findUniqueOrThrow({ where: { id: invoice.subscriptionId! }, include: { ledgerEntries: true } });
    expect(pkg.periodStartsAt?.toISOString()).toBe(NOV_10.toISOString());
    expect(pkg.periodEndsAt?.toISOString()).toBe("2026-12-09T22:00:00.000Z");
    expect(pkg.ledgerEntries).toEqual([expect.objectContaining({ entryType: "INITIAL_PURCHASE", sessionsDelta: 8, invoiceId: invoice.id })]);

    const after = await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after).toMatchObject({ status: "ACTIVE", graceEndsAt: null });
    expect(after.currentPeriodStart.toISOString()).toBe(NOV_10.toISOString());
    expect(after.currentPeriodEnd.toISOString()).toBe("2026-12-09T22:00:00.000Z");
    expect(client.nextBilling).toEqual([[sub.providerSubscriptionId, "2026-12-10"]]);
    expect((await jobs("RENEWAL_PAID")).map((job) => job.recipientUserId)).toEqual([fx.guardianUserId]);
  });

  it("RN-02: a repeated or concurrent sweep of the same transaction books nothing more", async () => {
    const sub = await billingSubscription("student2");
    const client = new FakeClient();
    client.transactions.push(txn(sub.providerSubscriptionId!));
    const now = new Date("2026-11-10T08:00:00Z");
    await Promise.all([sweepBillingSubscription(sub.id, { client, now }), sweepBillingSubscription(sub.id, { client, now })]);
    await sweepBillingSubscription(sub.id, { client, now });
    expect(await renewalInvoices(sub.id)).toHaveLength(1);
    expect(await prisma.subscription.count({ where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student2 } })).toBe(1);
  });

  it("RN-03: a wrong amount, currency, source or api_source moves no money; mismatches flag the Admin", async () => {
    const sub = await billingSubscription("student3");
    const client = new FakeClient();
    const otherSource = txn(sub.providerSubscriptionId!);
    client.transactions.push(
      txn(sub.providerSubscriptionId!, { amount_cents: 99999 }),
      txn(sub.providerSubscriptionId!, { currency: "USD" }),
      txn(sub.providerSubscriptionId!, { api_source: "IFRAME" }),
    );
    const listed = client.listTransactions.bind(client);
    client.listTransactions = async (id: string) => [...(await listed(id)), { ...otherSource, source_id: 12345 }];
    const result = await sweepBillingSubscription(sub.id, { client, now: new Date("2026-11-10T08:00:00Z") });
    expect(result.booked).toBe(0);
    expect(await renewalInvoices(sub.id)).toHaveLength(0);
    const flags = (await jobs("PAYMENT_ANOMALY")).filter((job) => job.recipientUserId === fx.adminUserId);
    const reasons = flags.map((job) => (job.payload as { reason: string }).reason).sort();
    expect(reasons).toEqual(expect.arrayContaining(["RENEWAL_AMOUNT_MISMATCH", "RENEWAL_CURRENCY_MISMATCH", "RENEWAL_SOURCE_MISMATCH"]));
    expect(client.nextBilling).toHaveLength(0);
  });

  it("RN-04: a failed renewal charge tells the payer once (with the cancel option) and moves no money", async () => {
    const sub = await billingSubscription("student4");
    const client = new FakeClient();
    client.transactions.push(txn(sub.providerSubscriptionId!, { success: false, error_occured: true }));
    const now = new Date("2026-11-10T08:00:00Z");
    await sweepBillingSubscription(sub.id, { client, now });
    await sweepBillingSubscription(sub.id, { client, now });
    expect(await renewalInvoices(sub.id)).toHaveLength(0);
    const failed = (await jobs("RENEWAL_FAILED")).filter((job) => (job.payload as { billingSubscriptionId: string }).billingSubscriptionId === sub.id);
    expect(failed.map((job) => job.recipientUserId)).toEqual([fx.guardianUserId]);
  });

  it("RN-05: no verified renewal by 06:00 after period end → PAST_DUE with a 3-day grace from period end, payer and Admin told once; not before 06:00", async () => {
    const sub = await billingSubscription("student5");
    const client = new FakeClient();
    await processRenewals(new Date(NOV_10.getTime() + 60 * 60 * 1000), { client, academyId: fx.academyId, sweepIntervalMs: 0 });
    expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("ACTIVE");

    const morning = new Date(NOV_10.getTime() + 7 * 60 * 60 * 1000);
    await processRenewals(morning, { client, academyId: fx.academyId, sweepIntervalMs: 0 });
    await processRenewals(morning, { client, academyId: fx.academyId, sweepIntervalMs: 0 });
    const after = await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.status).toBe("PAST_DUE");
    expect(after.graceEndsAt?.toISOString()).toBe(new Date(NOV_10.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString());
    const mine = (kind: string) => jobs(kind).then((rows) => rows.filter((job) => (job.payload as { billingSubscriptionId?: string }).billingSubscriptionId === sub.id));
    expect((await mine("RENEWAL_PAST_DUE")).map((job) => job.recipientUserId)).toEqual([fx.guardianUserId]);
    expect((await mine("RENEWAL_PAST_DUE_ADMIN")).map((job) => job.recipientUserId)).toEqual([fx.adminUserId]);
  });

  it("RN-06: a verified paid retry during grace restores ACTIVE; a retry weeks later pays the period that contains it", async () => {
    const sub = await billingSubscription("student6", { status: "PAST_DUE", graceEndsAt: new Date(NOV_10.getTime() + 3 * 86_400_000) });
    const client = new FakeClient();
    client.transactions.push(txn(sub.providerSubscriptionId!, { created_at: "2026-11-11T09:00:00" }));
    await processRenewals(new Date("2026-11-11T10:00:00Z"), { client, academyId: fx.academyId, sweepIntervalMs: 0 });
    const restored = await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(restored).toMatchObject({ status: "ACTIVE", graceEndsAt: null });
    expect((await renewalInvoices(sub.id))[0].billingPeriodStart?.toISOString().slice(0, 10)).toBe("2026-11-10");

    const late = await billingSubscription("student7", { status: "PAST_DUE" });
    const lateClient = new FakeClient();
    lateClient.transactions.push(txn(late.providerSubscriptionId!, { created_at: "2026-12-20T09:00:00" }));
    await sweepBillingSubscription(late.id, { client: lateClient, now: new Date("2026-12-20T10:00:00Z") });
    const [invoice] = await renewalInvoices(late.id);
    expect(invoice.billingPeriodStart?.toISOString().slice(0, 10)).toBe("2026-12-10");
    expect(lateClient.nextBilling).toEqual([[late.providerSubscriptionId, "2027-01-10"]]);
  });

  it("RN-07: cancel stops Paymob first and keeps the paid period; at period end the row is CANCELED without a past-due notice; a later charge moves no money", async () => {
    const sub = await billingSubscription("student8");
    const client = new FakeClient();
    const result = await cancelAutoRenewal(sub.id, { client, actorUserId: fx.guardianUserId });
    expect(result.periodEnd.toISOString()).toBe(NOV_10.toISOString());
    expect(client.cancelled).toEqual([sub.providerSubscriptionId]);
    const cancelled = await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(cancelled).toMatchObject({ status: "ACTIVE", autoRenew: false });
    expect(cancelled.canceledAt).not.toBeNull();
    expect((await jobs("RENEWAL_CANCELLED")).some((job) => job.recipientUserId === fx.guardianUserId)).toBe(true);

    client.transactions.push(txn(sub.providerSubscriptionId!));
    await processRenewals(new Date(NOV_10.getTime() + 8 * 3_600_000), { client, academyId: fx.academyId, sweepIntervalMs: 0 });
    const ended = await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(ended.status).toBe("CANCELED");
    expect(await renewalInvoices(sub.id)).toHaveLength(0);
    const pastDue = (await jobs("RENEWAL_PAST_DUE")).filter((job) => (job.payload as { billingSubscriptionId?: string }).billingSubscriptionId === sub.id);
    expect(pastDue).toHaveLength(0);
  });

  it("RN-08: if Paymob refuses the cancel, nothing changes locally", async () => {
    const sub = await billingSubscription("student9");
    const client = new FakeClient();
    client.failCancel = true;
    await expect(cancelAutoRenewal(sub.id, { client, actorUserId: fx.guardianUserId })).rejects.toBeInstanceOf(PaymentProviderError);
    expect(await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({ autoRenew: true, canceledAt: null });
  });

  it("RN-09: a signed callback is only a trigger: unknown subscription → unmatched; a renewal trigger sweeps; 'canceled' stops auto-renew", async () => {
    const client = new FakeClient();
    await expect(handleSubscriptionCallback({ triggerType: "Successful Transaction", providerSubscriptionId: "1" }, { client })).resolves.toEqual({ status: "unmatched" });
    const sub = await billingSubscription("student10");
    client.transactions.push(txn(sub.providerSubscriptionId!));
    await expect(handleSubscriptionCallback({ triggerType: "Successful Transaction", providerSubscriptionId: sub.providerSubscriptionId! }, { client, now: new Date("2026-11-10T08:00:00Z") })).resolves.toMatchObject({ status: "swept", booked: 1 });
    await expect(handleSubscriptionCallback({ triggerType: "canceled", providerSubscriptionId: sub.providerSubscriptionId! }, { client })).resolves.toEqual({ status: "cancel_recorded" });
    expect(await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({ autoRenew: false });
  });

  it("RN-10: when Paymob cannot be reached, nothing is marked past due that tick", async () => {
    const sub = await billingSubscription("student11");
    const client = new FakeClient();
    client.failList = true;
    await processRenewals(new Date(NOV_10.getTime() + 8 * 3_600_000), { client, academyId: fx.academyId, sweepIntervalMs: 0 });
    expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("ACTIVE");
  });

  it("RN-12 (static): the worker tick runs the renewal step before sending due jobs, limited to the tick's academy", () => {
    const worker = readFileSync(join(process.cwd(), "lib/worker/notifications.ts"), "utf8");
    const step = worker.indexOf("processRenewals(now, { academyId })");
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(worker.indexOf('["notification job processing"'));
  });

  it("RN-11: every renewal WhatsApp offers the cancel option and carries no amount or card data (ar + en)", () => {
    for (const kind of ["RENEWAL_PAID", "RENEWAL_FAILED", "RENEWAL_PAST_DUE"]) {
      for (const language of ["ar", "en"] as const) {
        const text = composeJobMessage({ kind, recipientUser: { preferredLanguage: language } } as never);
        expect(text).toMatch(language === "en" ? /cancel automatic renewal/i : /إلغاء التجديد التلقائي/);
        expect(text).not.toMatch(/\d{4,}|EGP|جنيه/);
      }
    }
  });
});
