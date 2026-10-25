import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRoles } from "../../../../../../lib/dal";
import { writePaymentAudit } from "../../../../../../lib/payments/audit";
import { prisma } from "../../../../../../lib/prisma";
import { paymentProofReviewSchema } from "../../../../../../lib/validation/financial";

/**
 * Admin reviews a payment proof. CONFIRM marks the evidence as verified — the
 * authoritative invoice transition still happens explicitly through
 * POST /api/invoices/[id]/confirm (which may reference this proof). A PENDING
 * proof can be re-reviewed; a decided proof is final (audit metadata preserved).
 */
export async function POST(request: Request, { params }: { params: Promise<{ proofId: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;
  const { proofId } = await params;
  if (!z.string().uuid().safeParse(proofId).success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid proof identifier." } }, { status: 400 });
  }
  const parsed = paymentProofReviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid review decision.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  const proof = await prisma.paymentProof.findFirst({
    where: { id: proofId, academyId: user.academyId },
    select: { id: true, status: true, invoiceId: true },
  });
  if (!proof) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Payment proof was not found." } }, { status: 404 });
  if (proof.status === "CONFIRMED" || proof.status === "REJECTED") {
    if (
      (parsed.data.action === "CONFIRM" && proof.status === "CONFIRMED") ||
      (parsed.data.action === "REJECT" && proof.status === "REJECTED")
    ) {
      const current = await prisma.paymentProof.findUniqueOrThrow({ where: { id: proofId }, select: { id: true, status: true, reviewNote: true, reviewedAt: true } });
      return NextResponse.json({ data: current, alreadyHandled: true });
    }
    return NextResponse.json({ error: { code: "PROOF_ALREADY_REVIEWED", message: "This proof has already been reviewed." } }, { status: 409 });
  }
  const reviewedAt = new Date();
  const claimed = await prisma.$transaction(async (tx) => {
    const count = await tx.paymentProof.updateMany({
      where: { id: proofId, status: "PENDING" },
      data: parsed.data.action === "CONFIRM"
        ? { status: "CONFIRMED", reviewedById: user.id, reviewedAt, reviewNote: parsed.data.note || null }
        : { status: "REJECTED", reviewedById: user.id, reviewedAt, reviewNote: parsed.data.note || null },
    });
    // Payment audit (Session 3, Slice A): a REJECTED proof is a REJECTED payment
    // event — commits with the review write; fail-closed (the review retry is safe).
    if (count.count > 0 && parsed.data.action === "REJECT") {
      await writePaymentAudit({
        academyId: user.academyId,
        invoiceId: proof.invoiceId,
        eventType: "REJECTED",
        actorId: user.id,
        actorRole: "ADMIN",
        metadata: { reason: parsed.data.note || "PROOF_REJECTED" },
      }, tx);
    }
    return count;
  });
  if (claimed.count === 0) {
    const current = await prisma.paymentProof.findUniqueOrThrow({ where: { id: proofId }, select: { id: true, status: true, reviewNote: true, reviewedAt: true } });
    return NextResponse.json({ data: current, alreadyHandled: true });
  }
  const updated = await prisma.paymentProof.findUniqueOrThrow({
    where: { id: proofId },
    select: { id: true, status: true, reviewNote: true, reviewedAt: true },
  });
  return NextResponse.json({ data: updated });
}
