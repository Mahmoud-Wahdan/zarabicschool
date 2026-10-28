import { NextResponse } from "next/server";
import { z } from "zod";

import { requestRefund } from "../../../../../lib/billing/refunds";
import { requireApiRole } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../../lib/request";

export const runtime = "nodejs";

const bodySchema = z.object({
  sessions: z.number().int().positive().max(1000),
  reason: z.string().trim().min(5).max(1000),
});

/**
 * POST /api/invoices/[id]/refunds — Admin only (S-13 c, D19/D42): a partial refund
 * by sessions through Paymob. A UUID Idempotency-Key header is REQUIRED (money
 * leaves the academy). 201 succeeded, 202 pending at Paymob, 200 replay.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid identifier.");
  const key = z.uuid().safeParse(request.headers.get("idempotency-key")?.trim());
  if (!key.success) return errorResponse(400, "VALIDATION_ERROR", "An Idempotency-Key (UUID) header is required.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "Sessions and a reason (5–1000 characters) are required.");
  const result = await requestRefund({ adminId: user.id, academyId: user.academyId, invoiceId: id, sessions: parsed.data.sessions, reason: parsed.data.reason, idempotencyKey: key.data.toLowerCase() });
  if (!result.ok) return errorResponse(result.status, result.code, result.message);
  return NextResponse.json({ data: result.refund }, { status: result.status });
}

/** GET — the invoice's refunds (Admin only). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid identifier.");
  const rows = await prisma.invoiceRefund.findMany({
    where: { invoiceId: id, academyId: user.academyId },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, sessionsRefunded: true, amountMinor: true, currency: true, reason: true, createdAt: true, completedAt: true },
  });
  return NextResponse.json({ data: rows.map((row) => ({ ...row, amountMinor: row.amountMinor.toString() })) });
}
