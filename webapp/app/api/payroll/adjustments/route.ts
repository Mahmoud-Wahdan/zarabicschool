import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { payrollAdjustmentSchema } from "../../../../lib/validation/financial";

/**
 * Admin-only manual payroll adjustment (fines, bonuses, corrections). Writes ONE
 * append-only ADMIN_ADJUSTMENT row with the acting Admin as created_by — history is
 * never edited or deleted (CONTEXT §7). The amount is signed: bonus > 0, fine < 0.
 */
export async function POST(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;
  const parsed = payrollAdjustmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid payroll adjustment.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  const teacher = await prisma.teacher.findFirst({
    where: { id: parsed.data.teacherId, academyId: user.academyId },
    select: { id: true },
  });
  if (!teacher) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Teacher not found." } }, { status: 404 });
  const entry = await prisma.payrollLedger.create({
    data: {
      academyId: user.academyId,
      teacherId: teacher.id,
      entryType: "ADMIN_ADJUSTMENT",
      amountMinor: parsed.data.amountMinor,
      currency: parsed.data.currency,
      reason: parsed.data.reason,
      createdById: user.id,
    },
    select: { id: true, teacherId: true, entryType: true, amountMinor: true, currency: true, createdAt: true },
  });
  return NextResponse.json({ data: entry }, { status: 201 });
}
