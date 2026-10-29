import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { createManualPayrollEntry } from "../../../../lib/payroll/manual-entry";
import { payrollDisbursementSchema } from "../../../../lib/validation/financial";
import { requireSameOrigin } from "../../../../lib/request";

/**
 * Admin-only payout record. Writes ONE append-only DISBURSEMENT row (negative
 * amount — money leaving the balance) with the acting Admin as created_by. This is
 * an internal ledger record; it is never treated as proof that an external bank
 * transfer actually happened.
 */
export async function POST(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;
  const parsed = payrollDisbursementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid disbursement.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  // A5: Idempotency-Key replay, one currency per teacher, append-only write.
  return createManualPayrollEntry(request, user, {
    entryType: "DISBURSEMENT",
    teacherId: parsed.data.teacherId,
    amountMinor: -parsed.data.amountMinor,
    currency: parsed.data.currency,
    reason: parsed.data.reason,
  });
}
