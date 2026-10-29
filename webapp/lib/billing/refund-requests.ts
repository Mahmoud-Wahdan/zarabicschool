import "server-only";

import { Prisma } from "../../generated/prisma/client";

import { prisma } from "../prisma";

/**
 * S-15 payer refund request (D74, owner 2026-10-29; SQL S-8). The payer (the guardian,
 * or an adult student who pays for themself) only ASKS for a refund of one PAID Paymob
 * invoice: no reason, no session count; the Admin decides the amount. One PENDING
 * request per invoice (partial unique index); after a rejection the payer may ask
 * again. The Admin either rejects with a reason, or approves by sending the existing
 * S-13c refund linked to the request (`linkApprovedRequest`, in that refund's own
 * transaction). Notices: the Admin in-app only (recorded SENT, never sent to
 * WhatsApp); the payer in-app + WhatsApp. Never the Supervisor (money). Ids only in
 * payloads, plus the amount (approval) or the Admin's reason (rejection) for the text.
 */
export type RefundRequestResult = { ok: true; status: 201 | 200; request: { id: string; status: string } } | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): RefundRequestResult => ({ ok: false, status, code, message });

/** The payer of an invoice's student, as the payment link (S-13a) defines it. */
function payerOf(student: { userId: string; isAdult: boolean; guardianId: string | null; guardian: { userId: string } | null }): { userId: string; path: "/guardian/invoices" | "/student/invoices" } | null {
  if (student.guardian) return { userId: student.guardian.userId, path: "/guardian/invoices" };
  if (student.isAdult && !student.guardianId) return { userId: student.userId, path: "/student/invoices" };
  return null;
}

export async function createRefundRequest(viewer: { id: string; academyId: string }, invoiceId: string): Promise<RefundRequestResult> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, academyId: viewer.academyId },
    select: { id: true, status: true, provider: true, student: { select: { userId: true, isAdult: true, guardianId: true, guardian: { select: { userId: true } } } } },
  });
  const payer = invoice ? payerOf(invoice.student) : null;
  // Not the viewer's invoice (another family, or not found): the same answer, no leak.
  if (!invoice || !payer || payer.userId !== viewer.id) return fail(404, "NOT_FOUND", "Invoice was not found.");
  if (invoice.status !== "PAID" || invoice.provider !== "PAYMOB") return fail(409, "NOT_REFUNDABLE", "Only a paid card payment can be refunded.");

  try {
    const request = await prisma.$transaction(async (tx) => {
      const row = await tx.refundRequest.create({ data: { academyId: viewer.academyId, invoiceId: invoice.id, requestedById: viewer.id }, select: { id: true, status: true } });
      const admins = await tx.user.findMany({ where: { academyId: viewer.academyId, role: "ADMIN", isActive: true }, select: { id: true } });
      const now = new Date();
      // In-app only: recorded SENT so the worker never sends it.
      await tx.notificationJob.createMany({
        data: admins.map((admin) => ({ academyId: viewer.academyId, sessionId: null, recipientUserId: admin.id, kind: "REFUND_REQUEST_RECEIVED", dedupKey: `REFUND_REQUEST_RECEIVED:${row.id}:${admin.id}`, scheduledFor: now, status: "SENT" as const, sentAt: now, payload: { requestId: row.id, invoiceId: invoice.id } })),
        skipDuplicates: true,
      });
      return row;
    });
    return { ok: true, status: 201, request };
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return fail(409, "REQUEST_ALREADY_OPEN", "A refund request for this invoice is already waiting.");
    throw cause;
  }
}

export async function rejectRefundRequest(admin: { id: string; academyId: string }, requestId: string, reason: string): Promise<RefundRequestResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM refund_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
    const row = await tx.refundRequest.findFirst({
      where: { id: requestId, academyId: admin.academyId },
      select: { id: true, status: true, requestedById: true, invoiceId: true, requestedBy: { select: { role: true } } },
    });
    if (!row) return fail(404, "NOT_FOUND", "Refund request was not found.");
    if (row.status !== "PENDING") return fail(409, "REQUEST_NOT_OPEN", "This request was already answered.");
    const now = new Date();
    await tx.refundRequest.update({ where: { id: row.id }, data: { status: "REJECTED", decidedById: admin.id, decidedAt: now, rejectionReason: reason } });
    await tx.notificationJob.create({
      data: {
        academyId: admin.academyId, sessionId: null, recipientUserId: row.requestedById, kind: "REFUND_REQUEST_REJECTED",
        dedupKey: `REFUND_REQUEST_REJECTED:${row.id}`, scheduledFor: now,
        payload: { requestId: row.id, invoiceId: row.invoiceId, reason, path: row.requestedBy.role === "STUDENT" ? "/student/invoices" : "/guardian/invoices" },
      },
    });
    return { ok: true, status: 200, request: { id: row.id, status: "REJECTED" } } as const;
  });
}

/** Called inside requestRefund's PENDING transaction: the request must be open and for this invoice. */
export async function lockOpenRequest(tx: Prisma.TransactionClient, requestId: string, invoiceId: string, academyId: string): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM refund_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
  const row = await tx.refundRequest.findFirst({ where: { id: requestId, academyId, invoiceId, status: "PENDING" }, select: { id: true } });
  return !!row;
}

/** Called once the linked refund was sent (SUCCEEDED, or accepted and pending at Paymob). */
export async function linkApprovedRequest(
  tx: Prisma.TransactionClient,
  input: { requestId: string; invoiceRefundId: string; adminId: string; academyId: string; amountMinor: bigint; currency: string },
): Promise<void> {
  const row = await tx.refundRequest.findFirst({ where: { id: input.requestId, academyId: input.academyId, status: "PENDING" }, select: { id: true, invoiceId: true, requestedById: true, requestedBy: { select: { role: true } } } });
  if (!row) return;
  const now = new Date();
  await tx.refundRequest.update({ where: { id: row.id }, data: { status: "APPROVED", decidedById: input.adminId, decidedAt: now, invoiceRefundId: input.invoiceRefundId } });
  await tx.notificationJob.create({
    data: {
      academyId: input.academyId, sessionId: null, recipientUserId: row.requestedById, kind: "REFUND_REQUEST_APPROVED",
      dedupKey: `REFUND_REQUEST_APPROVED:${row.id}`, scheduledFor: now,
      payload: { requestId: row.id, invoiceId: row.invoiceId, amountMinor: input.amountMinor.toString(), currency: input.currency, path: row.requestedBy.role === "STUDENT" ? "/student/invoices" : "/guardian/invoices" },
    },
  });
}

/** The Admin's list (academy-scoped), newest first. */
export async function listRefundRequests(academyId: string, status?: "PENDING" | "APPROVED" | "REJECTED") {
  const rows = await prisma.refundRequest.findMany({
    where: { academyId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, status: true, createdAt: true, decidedAt: true, rejectionReason: true, invoiceRefundId: true,
      requestedBy: { select: { displayName: true } },
      invoice: { select: { id: true, amountMinor: true, currency: true, sessionsPurchased: true, paidAt: true, student: { select: { user: { select: { displayName: true } } } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id, status: row.status, createdAt: row.createdAt.toISOString(), decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason, invoiceRefundId: row.invoiceRefundId, requestedBy: row.requestedBy.displayName,
    invoice: { id: row.invoice.id, amountMinor: row.invoice.amountMinor.toString(), currency: row.invoice.currency, sessionsPurchased: row.invoice.sessionsPurchased, paidAt: row.invoice.paidAt?.toISOString() ?? null, studentName: row.invoice.student.user.displayName },
  }));
}

export type RefundRequestRow = Awaited<ReturnType<typeof listRefundRequests>>[number];
