import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";

import { requireApiRole } from "../../../../../lib/dal";
import { isPhase6bReady } from "../../../../../lib/billing/readiness";
import { prisma } from "../../../../../lib/prisma";
import { exchangeRateCreateSchema } from "../../../../../lib/validation/billing";

/**
 * GET /api/admin/billing/exchange-rates
 * Admin-only: list configured exchange rates.
 */
export async function GET() {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;

  if (!(await isPhase6bReady())) {
    return NextResponse.json({
      data: [],
      migrationPending: true,
      message: "Exchange rates table is not yet migrated.",
    });
  }

  const rates = await prisma.exchangeRate.findMany({
    where: { academyId: user.academyId },
    orderBy: { effectiveFrom: "desc" },
    include: {
      createdBy: { select: { displayName: true } },
    },
    take: 50,
  });

  return NextResponse.json({
    data: rates.map((r) => ({
      id: r.id,
      fromCurrency: r.fromCurrency,
      toCurrency: r.toCurrency,
      rate: r.rate.toString(),
      effectiveFrom: r.effectiveFrom,
      createdByName: r.createdBy.displayName,
      createdAt: r.createdAt,
    })),
  });
}

/**
 * POST /api/admin/billing/exchange-rates
 * Admin-only: set a new effective exchange rate.
 * The snapshot is applied to all invoices created while this rate is effective.
 */
export async function POST(request: Request) {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;

  if (!(await isPhase6bReady())) {
    return NextResponse.json(
      { error: { code: "MIGRATION_PENDING", message: "Exchange rates table is not yet migrated." } },
      { status: 409 }
    );
  }

  const parsed = exchangeRateCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid exchange rate details.", fields: parsed.error.flatten().fieldErrors } },
      { status: 400 }
    );
  }

  const rate = await prisma.exchangeRate.create({
    data: {
      academyId: user.academyId,
      fromCurrency: parsed.data.fromCurrency,
      toCurrency: parsed.data.toCurrency,
      rate: new Prisma.Decimal(parsed.data.rate),
      createdById: user.id,
      effectiveFrom: new Date(),
    },
  });

  return NextResponse.json({
    data: {
      id: rate.id,
      fromCurrency: rate.fromCurrency,
      toCurrency: rate.toCurrency,
      rate: rate.rate.toString(),
      effectiveFrom: rate.effectiveFrom,
    },
  }, { status: 201 });
}
