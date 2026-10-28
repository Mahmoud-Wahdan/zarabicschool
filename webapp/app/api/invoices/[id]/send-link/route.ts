import { NextResponse } from "next/server";

import { requireApiRole } from "../../../../../lib/dal";
import { writePaymentAudit } from "../../../../../lib/payments/audit";
import { prisma } from "../../../../../lib/prisma";
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../../lib/request";
import { zonedYmd } from "../../../../../lib/schedules/recurrence";

export const runtime = "nodejs";

const MAX_LINKS_PER_INVOICE = 3;

/**
 * POST /api/invoices/[id]/send-link — Admin only (S-13 a, D6, D20): a WhatsApp
 * message to the PAYER (the linked guardian, or an adult student without a guardian)
 * pointing at the platform invoices page, in the payer's language. At most once a
 * calendar day (the payer's zone) and 3 times per invoice; each send is a LINK_SENT
 * audit row. Never a Paymob URL, never an amount in the message.
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
      student: { select: { userId: true, isAdult: true, guardianId: true, user: { select: { isActive: true, timezone: true } }, guardian: { select: { userId: true, user: { select: { isActive: true, timezone: true } } } } } },
    },
  });
  if (!invoice) return errorResponse(404, "NOT_FOUND", "Invoice was not found.");
  if (invoice.status !== "PENDING") return errorResponse(409, "INVOICE_NOT_PAYABLE", "Only an unpaid invoice can be sent.");
  const student = invoice.student;
  const payer = student.guardian
    ? { userId: student.guardian.userId, active: student.guardian.user.isActive, timezone: student.guardian.user.timezone, path: "/guardian/invoices" }
    : student.isAdult
      ? { userId: student.userId, active: student.user.isActive, timezone: student.user.timezone, path: "/student/invoices" }
      : null;
  if (!payer || !payer.active) return errorResponse(409, "NO_PAYER", "This invoice has no active payer to send it to.");

  const sent = await prisma.paymentAudit.findMany({ where: { invoiceId: invoice.id, eventType: "LINK_SENT" }, select: { createdAt: true } });
  if (sent.length >= MAX_LINKS_PER_INVOICE) return errorResponse(429, "LINK_LIMIT_REACHED", "This invoice was already sent 3 times.");
  const zone = payer.timezone || "Africa/Cairo";
  const today = zonedYmd(new Date(), zone);
  if (sent.some((row) => zonedYmd(row.createdAt, zone) === today)) {
    return errorResponse(429, "LINK_ALREADY_SENT_TODAY", "This invoice was already sent today.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.notificationJob.create({
      data: {
        academyId: user.academyId, sessionId: null, recipientUserId: payer.userId, kind: "INVOICE_PAYMENT_LINK",
        dedupKey: `INVOICE_PAYMENT_LINK:${invoice.id}:${today}`, scheduledFor: new Date(),
        payload: { invoiceId: invoice.id, path: payer.path },
      },
    });
    await writePaymentAudit({ academyId: user.academyId, invoiceId: invoice.id, eventType: "LINK_SENT", actorId: user.id, actorRole: "ADMIN", metadata: { reason: "PAYMENT_LINK" } }, tx);
  });
  return NextResponse.json({ data: { status: "queued", remaining: MAX_LINKS_PER_INVOICE - sent.length - 1 } }, { status: 201 });
}
