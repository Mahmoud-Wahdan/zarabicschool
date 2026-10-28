import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";

import { billingSubscriptionScope } from "../../../../lib/billing/renewal-access";
import { requireApiRoles } from "../../../../lib/dal";
import { requireStudentFinanceAccess } from "../../../../lib/guards/student-finance";
import { prisma } from "../../../../lib/prisma";

/**
 * Automatic renewals the caller may see (D52): the Admin's academy, a guardian's
 * children, or an adult student paying for themself. Never the Paymob ids.
 */
export async function GET() {
  const { user, error } = await requireApiRoles(["ADMIN", "GUARDIAN", "STUDENT"]);
  if (error) return error;
  if (user.role === "STUDENT") {
    try {
      await requireStudentFinanceAccess(user.id);
    } catch {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Students with a guardian cannot access financial operations." } }, { status: 403 });
    }
  }
  const locale = await getLocale();
  const rows = await prisma.billingSubscription.findMany({
    where: billingSubscriptionScope(user),
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      autoRenew: true,
      currency: true,
      lockedPriceMinor: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      graceEndsAt: true,
      canceledAt: true,
      plan: { select: { nameAr: true, nameEn: true } },
      student: { select: { user: { select: { displayName: true } } } },
    },
  });
  return NextResponse.json({
    subscriptions: rows.map((row) => ({
      id: row.id,
      status: row.status,
      autoRenew: row.autoRenew,
      currency: row.currency,
      amountMinor: row.lockedPriceMinor.toString(),
      currentPeriodStart: row.currentPeriodStart.toISOString(),
      currentPeriodEnd: row.currentPeriodEnd.toISOString(),
      graceEndsAt: row.graceEndsAt?.toISOString() ?? null,
      canceledAt: row.canceledAt?.toISOString() ?? null,
      planName: locale === "en" ? row.plan.nameEn : row.plan.nameAr,
      studentName: row.student.user.displayName,
    })),
  });
}
