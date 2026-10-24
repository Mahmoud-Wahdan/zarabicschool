import { NextResponse } from "next/server";
import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { PaymobProvider, PaymentProviderError, createUsdProvider } from "../../../../../lib/payments";
import { errorResponse, isSameOrigin } from "../../../../../lib/request";
export const runtime = "nodejs";

// Paymob payment keys are created with expiration: 3600 (lib/payments/paymob.ts);
// a checkout URL is reused only well inside that window so the payer never gets
// a dead token link. A CREATED attempt without a URL is an in-flight (or crashed)
// provider call: a concurrent checkout inside this window gets a clean 409
// instead of a SECOND provider order for the same invoice.
const CHECKOUT_REUSE_WINDOW_MS = 50 * 60 * 1000;
const CHECKOUT_IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000;

function splitName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "Customer", lastName: parts.slice(1).join(" ") || "Customer" };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(request.headers)) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
  }
  const { user, error } = await requireApiRoles(["ADMIN", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      academyId: true,
      studentId: true,
      amountMinor: true,
      currency: true,
      provider: true,
      status: true,
      student: {
        select: {
          userId: true,
          guardianId: true,
          user: { select: { displayName: true, email: true, phone: true } },
          guardian: { select: { userId: true, user: { select: { displayName: true, email: true, phone: true } } } },
        },
      },
    },
  });
  if (!invoice || invoice.academyId !== user.academyId) {
    return errorResponse(404, "NOT_FOUND", "Invoice was not found.");
  }
  // Finance wall (owner, 2026-10-18 — CONTEXT §12): a student WITH a guardian has
  // NO finance access at all — the guardian is the payer; only an ADULT student
  // without a guardian may pay for himself. Server-side, not only hidden in the UI.
  const isOwner = user.role === "ADMIN"
    || (user.role === "STUDENT" && invoice.student.userId === user.id && invoice.student.guardianId === null)
    || (user.role === "GUARDIAN" && invoice.student.guardian?.userId === user.id);
  if (!isOwner) return errorResponse(403, "FORBIDDEN", "You do not have access to this invoice.");
  if (invoice.status !== "PENDING") return errorResponse(409, "INVOICE_NOT_PAYABLE", "This invoice is not payable.");

  // Claim the invoice row FIRST, inside ONE transaction (Phase B review — checkout
  // concurrency): concurrent POSTs serialize on the invoice row, so at most one
  // active payment attempt is ever created. The idempotency key is deterministic
  // per attempt (invoice id + attempt number) — never a timestamp alone.
  const claim = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoice.id}::uuid FOR UPDATE`;
    const fresh = await tx.invoice.findUnique({
      where: { id: invoice.id },
      select: { id: true, status: true },
    });
    if (!fresh || fresh.status !== "PENDING") {
      return { kind: "not_payable" as const };
    }
    const activeAttempts = await tx.paymentAttempt.findMany({
      where: { invoiceId: invoice.id, status: { in: ["CREATED", "REDIRECTED"] } },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { id: true, status: true, checkoutUrl: true, providerReference: true, createdAt: true },
    });
    const newest = activeAttempts[0];
    const ageMs = newest ? Date.now() - newest.createdAt.getTime() : 0;
    if (newest?.checkoutUrl && newest.status === "REDIRECTED" && ageMs < CHECKOUT_REUSE_WINDOW_MS) {
      // Safe reuse: the payer gets the SAME provider order/URL (idempotent retry,
      // a second device, or a refresh) — never a second active attempt.
      return { kind: "reuse" as const, checkoutUrl: newest.checkoutUrl, providerReference: newest.providerReference };
    }
    if (newest?.status === "CREATED" && ageMs < CHECKOUT_IN_FLIGHT_WINDOW_MS) {
      // Another checkout for this invoice is mid-flight (its provider call has not
      // resolved yet): a concurrent request must NOT create a conflicting attempt.
      return { kind: "in_progress" as const };
    }
    // The newest attempt is unusable (an expired payment-token URL or an abandoned
    // claim) — fail ALL active attempts and take over.
    if (newest) {
      await tx.paymentAttempt.updateMany({
        where: { invoiceId: invoice.id, status: { in: ["CREATED", "REDIRECTED"] } },
        data: { status: "FAILED" },
      });
    }
    const priorCount = await tx.paymentAttempt.count({ where: { invoiceId: invoice.id } });
    const attempt = await tx.paymentAttempt.create({
      data: {
        invoiceId: invoice.id,
        provider: invoice.provider,
        idempotencyKey: `invoice:${invoice.id}:v${priorCount + 1}`,
        status: "CREATED",
      },
      select: { id: true, idempotencyKey: true },
    });
    return { kind: "claimed" as const, attemptId: attempt.id, idempotencyKey: attempt.idempotencyKey };
  });

  if (claim.kind === "not_payable") {
    return errorResponse(409, "INVOICE_NOT_PAYABLE", "This invoice is not payable.");
  }
  if (claim.kind === "in_progress") {
    return errorResponse(409, "CHECKOUT_IN_PROGRESS", "A checkout for this invoice is already in progress. Please retry in a moment.");
  }
  if (claim.kind === "reuse") {
    return NextResponse.json({ checkoutUrl: claim.checkoutUrl, providerReference: claim.providerReference });
  }

  const payer = user.role === "GUARDIAN" && invoice.student.guardian?.user
    ? invoice.student.guardian.user
    : invoice.student.user;
  const name = splitName(payer.displayName);
  try {
    const provider = invoice.provider === "PAYMOB" ? new PaymobProvider() : createUsdProvider();
    const checkout = await provider.createCheckout({
      invoiceId: invoice.id,
      amountMinor: invoice.amountMinor,
      currency: invoice.currency as "EGP" | "USD",
      description: `Zarabicschool invoice ${invoice.id}`,
      customer: {
        firstName: name.firstName,
        lastName: name.lastName,
        email: payer.email ?? "no-email@zarabicschool.local",
        phone: payer.phone ?? "0000000000",
      },
    }, claim.idempotencyKey);
    await prisma.paymentAttempt.update({
      where: { id: claim.attemptId },
      data: { checkoutUrl: checkout.checkoutUrl, providerReference: checkout.providerReference, status: "REDIRECTED" },
    });
    return NextResponse.json({ checkoutUrl: checkout.checkoutUrl, providerReference: checkout.providerReference });
  } catch (caught) {
    if (caught instanceof PaymentProviderError) {
      await prisma.paymentAttempt.update({ where: { id: claim.attemptId }, data: { status: "FAILED" } });
      return errorResponse(caught.status, caught.code, caught.message);
    }
    throw caught;
  }
}