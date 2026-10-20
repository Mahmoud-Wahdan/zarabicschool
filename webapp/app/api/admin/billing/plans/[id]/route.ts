import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRole } from "../../../../../../lib/dal";
import { isPhase6bReady } from "../../../../../../lib/billing/readiness";
import { prisma } from "../../../../../../lib/prisma";
import { billingPlanUpdateSchema } from "../../../../../../lib/validation/billing";

function isUuid(val: string) {
  return z.string().uuid().safeParse(val).success;
}

/**
 * PATCH /api/admin/billing/plans/[id]
 * Admin-only: update billing plan details or active state.
 * Important: Changing basePriceMinor here affects NEW subscriptions only;
 * existing subscribers retain their price locked on BillingSubscription (CONTEXT §20.4).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid plan identifier." } },
      { status: 400 }
    );
  }

  if (!(await isPhase6bReady())) {
    return NextResponse.json(
      { error: { code: "MIGRATION_PENDING", message: "Billing plans table is not yet migrated." } },
      { status: 409 }
    );
  }

  const parsed = billingPlanUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid update details.", fields: parsed.error.flatten().fieldErrors } },
      { status: 400 }
    );
  }

  const existing = await prisma.billingPlan.findFirst({
    where: { id, academyId: user.academyId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Billing plan not found." } },
      { status: 404 }
    );
  }

  const updateData: {
    nameAr?: string;
    nameEn?: string;
    basePriceMinor?: bigint;
    tier?: string | null;
    isActive?: boolean;
  } = {};

  if (parsed.data.nameAr !== undefined) updateData.nameAr = parsed.data.nameAr;
  if (parsed.data.nameEn !== undefined) updateData.nameEn = parsed.data.nameEn;
  if (parsed.data.basePriceMinor !== undefined) updateData.basePriceMinor = BigInt(parsed.data.basePriceMinor);
  if (parsed.data.tier !== undefined) updateData.tier = parsed.data.tier || null;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;

  const updated = await prisma.billingPlan.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({
    data: {
      ...updated,
      basePriceMinor: updated.basePriceMinor.toString(),
    },
  });
}
