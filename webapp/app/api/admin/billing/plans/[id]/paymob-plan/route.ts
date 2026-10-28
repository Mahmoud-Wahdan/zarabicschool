import { NextResponse } from "next/server";

import { platformUrl } from "../../../../../../../lib/config/platform-url";
import { requireApiRole } from "../../../../../../../lib/dal";
import { PaymobSubscriptionClient } from "../../../../../../../lib/payments/paymob-subscriptions";
import { PaymentProviderError } from "../../../../../../../lib/payments/types";
import { prisma } from "../../../../../../../lib/prisma";
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../../../../lib/request";

export const runtime = "nodejs";

/**
 * POST /api/admin/billing/plans/[id]/paymob-plan — Admin only (D53): create the
 * Paymob subscription plan behind an active monthly EGP plan, once. Its id is what
 * the sign-up sends (subscription_plan_id); Paymob calls our subscription webhook.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid plan identifier.");
  const plan = await prisma.billingPlan.findFirst({ where: { id, academyId: user.academyId } });
  if (!plan) return errorResponse(404, "NOT_FOUND", "Plan was not found.");
  if (plan.providerPlanId) return errorResponse(409, "ALREADY_LINKED", "This plan is already linked to Paymob.");
  if (plan.packageType !== "MONTHLY_PLAN" || plan.currency !== "EGP" || !plan.isActive) {
    return errorResponse(409, "PLAN_NOT_ELIGIBLE", "Only an active monthly EGP plan can renew automatically.");
  }
  const webhookUrl = platformUrl("/api/payments/paymob/subscription-webhook");
  if (!webhookUrl) return errorResponse(503, "NOT_CONFIGURED", "The platform public URL is not configured.");
  let providerPlanId: string;
  try {
    providerPlanId = await new PaymobSubscriptionClient().createPlan({ name: plan.nameEn, amountMinor: plan.basePriceMinor, webhookUrl });
  } catch (cause) {
    if (cause instanceof PaymentProviderError) {
      return errorResponse(cause.code === "NOT_CONFIGURED" ? 503 : 502, cause.code, "The plan could not be created at Paymob. Please try again later.");
    }
    throw cause;
  }
  // Two Admins at once: only the first link is kept (the other Paymob plan stays unused).
  const linked = await prisma.billingPlan.updateMany({ where: { id: plan.id, providerPlanId: null }, data: { providerPlanId } });
  if (linked.count === 0) return errorResponse(409, "ALREADY_LINKED", "This plan is already linked to Paymob.");
  return NextResponse.json({ providerPlanId }, { status: 201 });
}
