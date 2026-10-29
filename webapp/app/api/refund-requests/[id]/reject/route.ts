import { NextResponse } from "next/server";
import { z } from "zod";

import { rejectRefundRequest } from "../../../../../lib/billing/refund-requests";
import { requireApiRole } from "../../../../../lib/dal";
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../../lib/request";

export const runtime = "nodejs";

const bodySchema = z.object({ reason: z.string().trim().min(2).max(1000) });

/** S-15: the Admin rejects a payer's refund request with a reason (told to the payer). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid identifier.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "A reason (2–1000 characters) is required.");
  const result = await rejectRefundRequest(user, id, parsed.data.reason);
  if (!result.ok) return errorResponse(result.status, result.code, result.message);
  return NextResponse.json({ data: result.request });
}
