import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { createManualPayrollEntry } from "../../../../lib/payroll/manual-entry";
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
  });
}
