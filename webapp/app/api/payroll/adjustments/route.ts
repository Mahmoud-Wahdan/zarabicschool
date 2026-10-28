import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRoles } from "../../../../lib/dal";
import { listAdjustments } from "../../../../lib/payroll/adjustments";
import { createManualPayrollEntry } from "../../../../lib/payroll/manual-entry";
import { prisma } from "../../../../lib/prisma";
import { payrollAdjustmentSchema } from "../../../../lib/validation/financial";
import { requireSameOrigin } from "../../../../lib/request";

/**
 * Admin-only manual payroll adjustment (fines, bonuses, corrections). Writes ONE
 * append-only ADMIN_ADJUSTMENT row with the acting Admin as created_by — history is
 * never edited or deleted (CONTEXT §7). The amount is signed: bonus > 0, fine < 0.
 */
export async function POST(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;
  const parsed = payrollAdjustmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid payroll adjustment.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  // A5: Idempotency-Key replay, one currency per teacher, append-only write.
  return createManualPayrollEntry(request, user, {
    entryType: "ADMIN_ADJUSTMENT",
    teacherId: parsed.data.teacherId,
    amountMinor: parsed.data.amountMinor,
    currency: parsed.data.currency,
    reason: parsed.data.reason,
    adjustmentCategory: parsed.data.category,
  });
}

const listQuerySchema = z.object({
  teacherId: z.guid().optional(),
  category: z.enum(["BONUS", "FINE", "OVERTIME", "OTHER", "UNCATEGORIZED"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

/**
 * S-12 / D14: the Admin lists every adjustment (filter by teacher, category, dates);
 * a teacher lists only their own, with the reason. Supervisor never (no money).
 */
export async function GET(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "TEACHER"]);
  if (error) return error;
  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid filter." } }, { status: 400 });
  let teacherId = parsed.data.teacherId;
  if (user.role === "TEACHER") {
    const own = await prisma.teacher.findFirst({ where: { userId: user.id, academyId: user.academyId }, select: { id: true } });
    if (!own) return NextResponse.json({ data: [] });
    teacherId = own.id;
  }
  const entries = await listAdjustments({
    academyId: user.academyId,
    teacherId,
    category: parsed.data.category,
    from: parsed.data.from ? new Date(`${parsed.data.from}T00:00:00Z`) : undefined,
    to: parsed.data.to ? new Date(`${parsed.data.to}T00:00:00Z`) : undefined,
    forAdmin: user.role === "ADMIN",
  });
  return NextResponse.json({ data: entries });
}
