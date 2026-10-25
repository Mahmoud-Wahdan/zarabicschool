import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { payrollDisbursementSchema } from "../../../../lib/validation/financial";

/**
 * Admin-only payout record. Writes ONE append-only DISBURSEMENT row (negative
 * amount — money leaving the balance) with the acting Admin as created_by. This is
 * an internal ledger record; it is never treated as proof that an external bank
 * transfer actually happened.
 */
export async function POST(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;
  const parsed = payrollDisbursementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid disbursement.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  const teacher = await prisma.teacher.findFirst({
    where: { id: parsed.data.teacherId, academyId: user.academyId },
    select: { id: true },
  });
  if (!teacher) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Teacher not found." } }, { status: 404 });
  const entry = await prisma.payrollLedger.create({
    data: {
      academyId: user.academyId,
      teacherId: teacher.id,
      entryType: "DISBURSEMENT",
      amountMinor: -parsed.data.amountMinor,
      currency: parsed.data.currency,
      reason: parsed.data.reason,
      createdById: user.id,
    },
    select: { id: true, teacherId: true, entryType: true, amountMinor: true, currency: true, createdAt: true },
  });
  return NextResponse.json({ data: entry }, { status: 201 });
}
