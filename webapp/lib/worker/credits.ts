import "server-only";

import { prisma } from "../prisma";
import { runSerializable } from "../credits/reservation";

/**
 * Monthly credit EXPIRY — "no rollover" (CONFIRMED — CONTEXT §7): unused monthly
 * sessions expire at the end of their subscription period, and the worker writes
 * the EXPIRY ledger entry so the append-only ledger stays the single balance
 * source ("EXPIRY (written by the worker at period end for unused monthly
 * sessions)"). Annual subscriptions run on the same one-month credit windows
 * (their monthly grants arrive with the still-blocked Phase 6b grant flow), so
 * their unused window credits expire the same way. Pay-per-session credits never
 * expire and are never touched here.
 *
 * A session that is scheduled but not yet settled keeps its reservation: the
 * reserved amount survives period end so the later settlement consumes normally;
 * once the reservation resolves (CONSUMED / RELEASED) a later pass expires any
 * remainder. A settlement that lands after the remainder expired drives the
 * balance negative — the existing approved rule applies (settle anyway, flag
 * Admin; CONTEXT §7).
 *
 * Idempotent and concurrency-safe: each subscription is processed in ONE
 * serializable transaction that re-reads the row under lock; the expirable
 * amount is recomputed inside it, so a re-run or an overlapping worker can
 * never write a duplicate entry. The terminal status transition is conditional
 * (only from ACTIVE), so exactly one pass finalizes each subscription.
 */
export async function processMonthlyCreditExpiry(now = new Date(), academyId?: string) {
  const ended = await prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      packageType: { in: ["MONTHLY_PLAN", "ANNUAL_PLAN"] },
      periodEndsAt: { lte: now },
      ...(academyId ? { academyId } : {}),
    },
    orderBy: { periodEndsAt: "asc" },
    select: { id: true },
    take: 100,
  });
  for (const subscription of ended) {
    try {
      await runSerializable(async (tx) => {
        await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${subscription.id}::uuid FOR UPDATE`;
        const fresh = await tx.subscription.findUnique({
          where: { id: subscription.id },
          select: {
            id: true,
            academyId: true,
            status: true,
            packageType: true,
            periodEndsAt: true,
            ledgerEntries: { select: { entryType: true, sessionsDelta: true, invoiceId: true } },
            reservations: { where: { status: "RESERVED" }, select: { id: true } },
          },
        });
        if (
          !fresh ||
          fresh.status !== "ACTIVE" ||
          !fresh.periodEndsAt ||
          fresh.periodEndsAt.getTime() > now.getTime() ||
          fresh.packageType === "PAY_PER_SESSION"
        ) {
          return null;
        }
        const balance = fresh.ledgerEntries.reduce((total, entry) => total + entry.sessionsDelta, 0);
        const reservedCount = fresh.reservations.length;
        const expirable = Math.max(balance - reservedCount, 0);
        if (expirable > 0) {
          // Traceability: the EXPIRY entry points at the invoice that funded the
          // expired period (the subscription's INITIAL_PURCHASE invoice).
          const fundingInvoiceId =
            fresh.ledgerEntries.find((entry) => entry.entryType === "INITIAL_PURCHASE")?.invoiceId ?? null;
          await tx.subscriptionLedger.create({
            data: {
              academyId: fresh.academyId,
              subscriptionId: fresh.id,
              invoiceId: fundingInvoiceId,
              entryType: "EXPIRY",
              sessionsDelta: -expirable,
            },
          });
        }
        const balanceAfter = balance - expirable;
        // Terminal state only when nothing is pending: reserved sessions may still
        // settle, so a subscription with live reservations stays ACTIVE for the
        // next pass; once it is fully drained it finalizes exactly once.
        if (reservedCount === 0 && balanceAfter <= 0) {
          const everExpired = expirable > 0 || fresh.ledgerEntries.some((entry) => entry.entryType === "EXPIRY");
          await tx.subscription.updateMany({
            where: { id: fresh.id, status: "ACTIVE" },
            data: { status: everExpired ? "EXPIRED" : "EXHAUSTED" },
          });
        }
        return null;
      });
    } catch {
      // One bad subscription must never stop the batch (same isolation pattern
      // as extendDueSeries). No payload is logged — ids stay in the DB only.
      console.error(`[worker] credit expiry pass failed for subscription ${subscription.id}.`);
    }
  }
}
