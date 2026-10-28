import "server-only";

import type { AuthUser } from "../dal";
import { formatMoney } from "../payments/format";
import { prisma } from "../prisma";
import { billingSubscriptionScope } from "./renewal-access";

/**
 * Page data for the automatic-renewal panel (D52-D57): the subscriptions the viewer
 * may see (same scope as the API), the students they pay for, and the monthly EGP
 * plans open for automatic renewal. Never the Paymob ids.
 */
export type RenewalRow = {
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

export type RenewalPlan = { id: string; name: string; sessions: number; priceLabel: string; priceMinor: string };

export async function loadRenewalRows(user: AuthUser, locale: string): Promise<RenewalRow[]> {
  const rows = await prisma.billingSubscription.findMany({
    where: billingSubscriptionScope(user),
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, studentId: true, status: true, autoRenew: true, currency: true, lockedPriceMinor: true, currentPeriodEnd: true, graceEndsAt: true,
      plan: { select: { nameAr: true, nameEn: true } },
      student: { select: { user: { select: { displayName: true } } } },
      payerUser: { select: { displayName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    studentId: row.studentId,
    studentName: row.student.user.displayName,
    planName: locale === "en" ? row.plan.nameEn : row.plan.nameAr,
    payerName: row.payerUser.displayName,
    priceLabel: formatMoney(row.lockedPriceMinor, row.currency, locale),
    status: row.status,
    autoRenew: row.autoRenew,
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    graceEndsAt: row.graceEndsAt?.toISOString() ?? null,
  }));
}

export async function loadRenewalPlans(academyId: string, locale: string): Promise<RenewalPlan[]> {
  const plans = await prisma.billingPlan.findMany({
    where: { academyId, isActive: true, packageType: "MONTHLY_PLAN", currency: "EGP", providerPlanId: { not: null } },
    orderBy: { basePriceMinor: "asc" },
    select: { id: true, nameAr: true, nameEn: true, sessionsPerMonth: true, basePriceMinor: true, currency: true },
  });
  return plans.map((plan) => ({
    id: plan.id,
    name: locale === "en" ? plan.nameEn : plan.nameAr,
    sessions: plan.sessionsPerMonth,
    priceLabel: formatMoney(plan.basePriceMinor, plan.currency, locale),
    priceMinor: plan.basePriceMinor.toString(),
  }));
}
