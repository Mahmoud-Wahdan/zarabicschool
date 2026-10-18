import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { PaymentProviderError, settleInvoiceConfirmedByAdmin } from "../../../../../lib/payments";
import { invoiceConfirmSchema } from "../../../../../lib/validation/financial";
import { errorResponse, isSameOrigin } from "../../../../../lib/request";

export const runtime = "nodejs";

/**
 * Admin confirms a manual payment (proof fallback / external transfer). This is the
 * ONLY manual path to the authoritative invoice transition — the same atomic
 * settlement the signed Paymob webhook performs. Idempotent: an already-paid
 * invoice answers "already_settled", not an error.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request.headers)) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
  }
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;
  const { id } = await params;
  const parsed = invoiceConfirmSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid confirmation details.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  const invoice = await prisma.invoice.findFirst({
    where: { id, academyId: user.academyId },
    select: { id: true },
  });
  if (!invoice) return errorResponse(404, "NOT_FOUND", "Invoice was not found.");
  if (parsed.data.paymentProofId) {
    const proof = await prisma.paymentProof.findFirst({
      where: { id: parsed.data.paymentProofId, invoiceId: invoice.id, academyId: user.academyId },
      select: { id: true, status: true },
    });
    if (!proof) return errorResponse(404, "NOT_FOUND", "Payment proof was not found.");
    if (proof.status === "REJECTED") {
      return errorResponse(409, "PROOF_REJECTED", "This payment proof was rejected and cannot confirm the invoice.");
    }
  }
  try {
    const result = await settleInvoiceConfirmedByAdmin({
      invoiceId: invoice.id,
      adminId: user.id,
      reference: parsed.data.reference || undefined,
      paymentProofId: parsed.data.paymentProofId,
    });
    return NextResponse.json({ data: result });
  } catch (cause) {
    if (cause instanceof PaymentProviderError) {
      return errorResponse(cause.status, cause.code, cause.message);
    }
    throw cause;
  }
}
