import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { PaymobProvider, PaymentProviderError, createUsdProvider } from "../../../../../lib/payments";
import { errorResponse, isSameOrigin } from "../../../../../lib/request";

export const runtime = "nodejs";

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
      attempts: {
        where: { status: { in: ["CREATED", "REDIRECTED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { checkoutUrl: true, providerReference: true, idempotencyKey: true },
      },
    },
  });
  if (!invoice || invoice.academyId !== user.academyId) {
    return errorResponse(404, "NOT_FOUND", "Invoice was not found.");
  }
  const isOwner = user.role === "ADMIN"
    || (user.role === "STUDENT" && invoice.student.userId === user.id)
    || (user.role === "GUARDIAN" && invoice.student.guardian?.userId === user.id);
  if (!isOwner) return errorResponse(403, "FORBIDDEN", "You do not have access to this invoice.");
  if (invoice.status !== "PENDING") return errorResponse(409, "INVOICE_NOT_PAYABLE", "This invoice is not payable.");
  const existing = invoice.attempts[0];
  if (existing?.checkoutUrl) {
    return NextResponse.json({ checkoutUrl: existing.checkoutUrl, providerReference: existing.providerReference });
  }

  const idempotencyKey = `invoice:${invoice.id}:${Date.now()}`;
  const attempt = await prisma.paymentAttempt.create({
    data: { invoiceId: invoice.id, provider: invoice.provider, idempotencyKey, status: "CREATED" },
  });
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
    }, idempotencyKey);
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { checkoutUrl: checkout.checkoutUrl, providerReference: checkout.providerReference, status: "REDIRECTED" },
    });
    return NextResponse.json({ checkoutUrl: checkout.checkoutUrl, providerReference: checkout.providerReference });
  } catch (caught) {
    if (caught instanceof PaymentProviderError) {
      await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED" } });
      return errorResponse(caught.status, caught.code, caught.message);
    }
    throw caught;
  }
}
