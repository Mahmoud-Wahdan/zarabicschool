import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { invoiceCreateSchema } from "../../../lib/validation/financial";

/**
 * Admin creates a PENDING invoice for one student. The amount is whatever the Admin
 * enters (Admin-set pricing; no invented plan prices). The checkout later reads the
 * amount from THIS row — never from the client.
 */
export async function POST(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;
  const parsed = invoiceCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid invoice details.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  const student = await prisma.student.findFirst({
    where: { id: parsed.data.studentId, academyId: user.academyId },
    select: { id: true },
  });
  if (!student) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Student not found." } }, { status: 404 });
  const invoice = await prisma.invoice.create({
    data: {
      academyId: user.academyId,
      studentId: student.id,
      amountMinor: BigInt(parsed.data.amountMinor),
      currency: parsed.data.currency,
      provider: parsed.data.provider,
      exchangeRate: parsed.data.exchangeRate ?? null,
      packageType: parsed.data.packageType,
      sessionsPurchased: parsed.data.sessionsPurchased,
      status: "PENDING",
    },
    select: { id: true, amountMinor: true, currency: true, status: true, packageType: true, sessionsPurchased: true, createdAt: true },
  });
  return NextResponse.json({ data: { ...invoice, amountMinor: invoice.amountMinor.toString() } }, { status: 201 });
}
