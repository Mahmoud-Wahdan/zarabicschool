import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";

import { z } from "zod";

import { billingSubscriptionScope } from "../../../../lib/billing/renewal-access";
import { startRenewalSignup } from "../../../../lib/billing/renewal-signup";
import { isAutoRenewalEnabled } from "../../../../lib/config/features";
import { requireApiRoles } from "../../../../lib/dal";
import { requireStudentFinanceAccess } from "../../../../lib/guards/student-finance";
import { prisma } from "../../../../lib/prisma";
import { errorResponse, requireSameOrigin } from "../../../../lib/request";

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

const signupSchema = z.object({
  studentId: z.string().uuid(),
  planId: z.string().uuid(),
  // D57: explicit consent to automatic monthly charges; nothing else is accepted.
  consent: z.literal(true),
});

/** Start automatic renewal (D55): consent + month-1 payment through Paymob's Unified Checkout. */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { user, error } = await requireApiRoles(["GUARDIAN", "STUDENT"]);
  if (error) return error;
  if (user.role === "STUDENT") {
    try {
      await requireStudentFinanceAccess(user.id);
    } catch {
      return errorResponse(403, "FORBIDDEN", "Students with a guardian cannot access financial operations.");
    }
  }
  // A6: sign-up is hidden until automatic renewal is verified with Paymob (flag OFF by
  // default). Checked after origin, session and role, so those answers never change.
  if (!isAutoRenewalEnabled()) return errorResponse(404, "FEATURE_DISABLED", "Automatic renewal is not available yet.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid request body.");
  }
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "Consent and a valid student and plan are required.");
  const locale = (await getLocale()) === "en" ? "en" : "ar";
  const result = await startRenewalSignup({ user, studentId: parsed.data.studentId, planId: parsed.data.planId, locale });
  if (!result.ok) return errorResponse(result.status, result.code, result.message);
  return NextResponse.json({ checkoutUrl: result.checkoutUrl, billingSubscriptionId: result.billingSubscriptionId }, { status: 201 });
}
