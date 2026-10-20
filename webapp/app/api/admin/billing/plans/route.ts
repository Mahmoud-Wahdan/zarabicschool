import { NextResponse } from "next/server";

import { requireApiRole } from "../../../../../lib/dal";
import { isPhase6bReady } from "../../../../../lib/billing/readiness";
import { prisma } from "../../../../../lib/prisma";
import { billingPlanCreateSchema } from "../../../../../lib/validation/billing";

/**
 * GET /api/admin/billing/plans
 * Admin-only: list all billing plans for the academy.
 * Supervisor gets HTTP 403 Forbidden (no financial data access).
 */
export async function GET() {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;

  if (!(await isPhase6bReady())) {
    return NextResponse.json({
      data: [],
      migrationPending: true,
      message: "Billing plans table is not yet migrated. Apply migration 20261020000000_phase6b_subscriptions_and_plans.",
    });
  }

  const plans = await prisma.billingPlan.findMany({
    where: { academyId: user.academyId },
    orderBy: [{ packageType: "asc" }, { sessionsPerMonth: "asc" }],
    include: {
      _count: { select: { subscriptions: true } },
    },
  });

  return NextResponse.json({
    data: plans.map((plan) => ({
      ...plan,
      basePriceMinor: plan.basePriceMinor.toString(),
      activeSubscribersCount: plan._count.subscriptions,
    })),
  });
}

/**
 * POST /api/admin/billing/plans
 * Admin-only: create a new billing plan.
 */
export async function POST(request: Request) {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;

  if (!(await isPhase6bReady())) {
    return NextResponse.json(
      { error: { code: "MIGRATION_PENDING", message: "Billing plans table is not yet migrated." } },
      { status: 409 },
    );
  }

  const parsed = billingPlanCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid plan details.", fields: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }

  const plan = await prisma.billingPlan.create({
    data: {
      academyId: user.academyId,
      nameAr: parsed.data.nameAr,
      nameEn: parsed.data.nameEn,
      packageType: parsed.data.packageType,
      sessionsPerMonth: parsed.data.sessionsPerMonth,
      basePriceMinor: BigInt(parsed.data.basePriceMinor),
      currency: parsed.data.currency,
      tier: parsed.data.tier || null,
      isActive: true,
    },
  });

  return NextResponse.json(
    { data: { ...plan, basePriceMinor: plan.basePriceMinor.toString() } },
    { status: 201 },
  );
}
