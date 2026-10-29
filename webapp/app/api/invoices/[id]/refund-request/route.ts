import { NextResponse } from "next/server";

import { createRefundRequest } from "../../../../../lib/billing/refund-requests";
import { requireApiRoles } from "../../../../../lib/dal";
import { requireStudentFinanceAccess } from "../../../../../lib/guards/student-finance";
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../../lib/request";

export const runtime = "nodejs";

/**
 * S-15 (D74): the payer asks the academy to refund a paid card payment. No reason and
 * no session count (owner, 2026-10-29); the Admin decides. Only the payer: a guardian,
 * or an adult student who pays for themself (a student with a guardian is refused by
 * the finance wall). One open request per invoice.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid identifier.");
  const result = await createRefundRequest(user, id);
  if (!result.ok) return errorResponse(result.status, result.code, result.message);
  return NextResponse.json({ data: result.request }, { status: result.status });
}
