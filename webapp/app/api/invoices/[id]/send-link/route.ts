import { NextResponse } from "next/server";

import { requireApiRole } from "../../../../../lib/dal";
import { writePaymentAudit } from "../../../../../lib/payments/audit";
import { prisma } from "../../../../../lib/prisma";
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../../lib/request";

export const runtime = "nodejs";

const MAX_LINKS_PER_INVOICE = 3;
/** D81 (owner, 2026-10-29): "once a day" = a rolling 24 hours since the last link. */
const LINK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/invoices/[id]/send-link — Admin only (S-13 a, D6, D20): a WhatsApp
 * message to the PAYER (the linked guardian, or an adult student without a guardian)
 * pointing at the platform invoices page, in the payer's language. At most once in
 * any rolling 24 hours (D81) and 3 times per invoice, checked under the invoice row
 * lock so two concurrent sends queue one link; each send is a LINK_SENT audit row.
 * Never a Paymob URL, never an amount in the message.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid identifier.");
  const invoice = await prisma.invoice.findFirst({
    where: { id, academyId: user.academyId },
    select: {
      id: true, status: true,
      student: { select: { userId: true, isAdult: true, guardianId: true, user: { select: { isActive: true } }, guardian: { select: { userId: true, user: { select: { isActive: true } } } } } },
    },
  });
  if (!invoice) return errorResponse(404, "NOT_FOUND", "Invoice was not found.");
  if (invoice.status !== "PENDING") return errorResponse(409, "INVOICE_NOT_PAYABLE", "Only an unpaid invoice can be sent.");
  const student = invoice.student;
  const payer = student.guardian
    ? { userId: student.guardian.userId, active: student.guardian.user.isActive, path: "/guardian/invoices" }
    : student.isAdult
      ? { userId: student.userId, active: student.user.isActive, path: "/student/invoices" }
      : null;
  if (!payer || !payer.active) return errorResponse(409, "NO_PAYER", "This invoice has no active payer to send it to.");

  let remaining = 0;
  const refusal = await prisma.$transaction(async (tx) => {
    // The invoice row lock serializes two sends of the same invoice: the second one
    // sees the first one's LINK_SENT row and is refused.
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoice.id}::uuid FOR UPDATE`;
    const sent = await tx.paymentAudit.findMany({ where: { invoiceId: invoice.id, eventType: "LINK_SENT" }, select: { createdAt: true } });
    if (sent.length >= MAX_LINKS_PER_INVOICE) return { code: "LINK_LIMIT_REACHED", message: "This invoice was already sent 3 times." };
    const now = Date.now();
    if (sent.some((row) => now - row.createdAt.getTime() < LINK_INTERVAL_MS)) {
      return { code: "LINK_ALREADY_SENT_TODAY", message: "This invoice was already sent in the last 24 hours." };
    }
    await tx.notificationJob.create({
      data: {
        academyId: user.academyId, sessionId: null, recipientUserId: payer.userId, kind: "INVOICE_PAYMENT_LINK",
        // One job per link number (1..3): unique by construction under the lock above.
        dedupKey: `INVOICE_PAYMENT_LINK:${invoice.id}:${sent.length + 1}`, scheduledFor: new Date(),
        payload: { invoiceId: invoice.id, path: payer.path },
      },
    });
    await writePaymentAudit({ academyId: user.academyId, invoiceId: invoice.id, eventType: "LINK_SENT", actorId: user.id, actorRole: "ADMIN", metadata: { reason: "PAYMENT_LINK" } }, tx);
    remaining = MAX_LINKS_PER_INVOICE - sent.length - 1;
    return null;
  });
  if (refusal) return errorResponse(429, refusal.code, refusal.message);
  return NextResponse.json({ data: { status: "queued", remaining } }, { status: 201 });
}
