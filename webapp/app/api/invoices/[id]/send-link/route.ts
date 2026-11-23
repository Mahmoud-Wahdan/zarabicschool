import { NextResponse } from "next/server";

import { requireApiRole } from "../../../../../lib/dal";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../../../lib/prisma";
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../../lib/request";

export const runtime = "nodejs";

const MAX_LINKS_PER_INVOICE = 3;
const LINK_INTERVAL_MS = 5 * 60 * 1000;

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
    const locked = await tx.$queryRaw<{status: string}[]>`SELECT status FROM invoices WHERE id = ${invoice.id}::uuid FOR UPDATE`;
    if (locked[0]?.status !== "PENDING") return { code: "INVOICE_NOT_PAYABLE", message: "Only an unpaid invoice can be sent.", status: 409 };
    const scope = {
      academyId: user.academyId, kind: "INVOICE_PAYMENT_LINK",
      dedupKey: { startsWith: `INVOICE_PAYMENT_LINK:${invoice.id}:` },
    };
    const jobs = await tx.notificationJob.findMany({
      where: scope, select: { status: true, sentAt: true, deliveryStatus: true, providerMessageId: true },
    });
    if (jobs.some(job => job.status === "PENDING" || job.status === "PROCESSING")) {
      return { code: "LINK_ALREADY_QUEUED", message: "A payment link is already queued.", status: 409 };
    }
    const sent = jobs.filter(job => job.status === "SENT" && job.providerMessageId && job.deliveryStatus !== "FAILED");
    if (sent.length >= MAX_LINKS_PER_INVOICE) return { code: "LINK_LIMIT_REACHED", message: "This invoice was already sent 3 times.", status: 429 };
    if (sent.some(job => job.sentAt && Date.now() - job.sentAt.getTime() < LINK_INTERVAL_MS)) {
      return { code: "LINK_COOLDOWN", message: "Wait five minutes before sending another payment link.", status: 429 };
    }
    await tx.notificationJob.create({
      data: {
        academyId: user.academyId, sessionId: null, recipientUserId: payer.userId, kind: "INVOICE_PAYMENT_LINK",
        dedupKey: `INVOICE_PAYMENT_LINK:${invoice.id}:${randomUUID()}`, scheduledFor: new Date(),
        payload: { invoiceId: invoice.id, path: payer.path, requestedBy: user.id },
      },
    });
    remaining = MAX_LINKS_PER_INVOICE - sent.length - 1;
    return null;
  });
  if (refusal) return errorResponse(refusal.status, refusal.code, refusal.message);
  return NextResponse.json({ data: { status: "queued", remaining } }, { status: 201 });
}
