import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRoles } from "../../../../../../lib/dal";
import { reversalKey } from "../../../../../../lib/payroll/adjustments";
import { createManualPayrollEntry } from "../../../../../../lib/payroll/manual-entry";
import { prisma } from "../../../../../../lib/prisma";
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../../../lib/request";

const bodySchema = z.object({ reason: z.string().trim().min(2).max(900) });

/**
 * POST /api/payroll/adjustments/[id]/reverse — Admin only (S-12, D14): the append-only
 * ledger is corrected by ONE opposite entry with the same category and the Admin's
 * reason. A second reversal of the same entry is refused (deterministic key).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;
  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid identifier.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "A reason is required to reverse an entry.");
  const original = await prisma.payrollLedger.findFirst({
    where: { id, academyId: user.academyId, entryType: "ADMIN_ADJUSTMENT" },
    select: { id: true, teacherId: true, amountMinor: true, currency: true, adjustmentCategory: true, reportId: true },
  });
  if (!original) return errorResponse(404, "NOT_FOUND", "Adjustment was not found.");
  const key = reversalKey(original.id);
  if (await prisma.payrollLedger.findFirst({ where: { idempotencyKey: key }, select: { id: true } })) {
    return errorResponse(409, "ALREADY_REVERSED", "This entry was already reversed.");
  }
  // Same category as the original (D40: an overtime row is OVERTIME); an older uncategorized row stays uncategorized.
  const category = (original.adjustmentCategory ?? (original.reportId ? "OVERTIME" : undefined)) as "BONUS" | "FINE" | "OVERTIME" | "OTHER" | undefined;
  const response = await createManualPayrollEntry(request, user, {
    entryType: "ADMIN_ADJUSTMENT",
    teacherId: original.teacherId,
    amountMinor: -original.amountMinor,
    currency: original.currency,
    reason: `Reversal: ${parsed.data.reason}`,
    adjustmentCategory: category,
  }, key);
  // A concurrent second reversal lands on the same key and replays (200): still one entry.
  return response.status === 200 ? errorResponse(409, "ALREADY_REVERSED", "This entry was already reversed.") : (response as NextResponse);
}
