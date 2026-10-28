import { NextResponse } from "next/server";

import { cancelAutoRenewal } from "../../../../../../lib/billing/renewal";
import { billingSubscriptionScope } from "../../../../../../lib/billing/renewal-access";
import { requireApiRoles } from "../../../../../../lib/dal";
import { requireStudentFinanceAccess } from "../../../../../../lib/guards/student-finance";
import { PaymentProviderError } from "../../../../../../lib/payments/types";
import { prisma } from "../../../../../../lib/prisma";
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../../../lib/request";

export const runtime = "nodejs";

/**
 * D52: stop automatic renewal. Paymob is cancelled FIRST (final at Paymob); if that
 * call fails nothing changes here and the payer sees the error, so the app never
 * says "cancelled" while Paymob can still charge. The paid period stays usable.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { user, error } = await requireApiRoles(["ADMIN", "GUARDIAN", "STUDENT"]);
  if (error) return error;
  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid identifier.");
  if (user.role === "STUDENT") {
    try {
      await requireStudentFinanceAccess(user.id);
    } catch {
      return errorResponse(403, "FORBIDDEN", "Students with a guardian cannot access financial operations.");
    }
  }
  const sub = await prisma.billingSubscription.findFirst({ where: { id, ...billingSubscriptionScope(user) }, select: { id: true } });
  if (!sub) return errorResponse(404, "NOT_FOUND", "Subscription was not found.");
  try {
    const result = await cancelAutoRenewal(sub.id, { actorUserId: user.id });
    return NextResponse.json({ status: result.status, periodEnd: result.periodEnd.toISOString() });
  } catch (cause) {
    if (cause instanceof PaymentProviderError) {
      return errorResponse(cause.code === "NOT_CONFIGURED" ? 503 : 502, cause.code, "Automatic renewal could not be cancelled at the payment provider. Please try again later.");
    }
    throw cause;
  }
}
