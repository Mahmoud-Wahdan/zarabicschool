import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRoles } from "../../../../lib/dal";
import { requireStudentFinanceAccess } from "../../../../lib/guards/student-finance";
import { prisma } from "../../../../lib/prisma";

function isUuid(value: string) {
  return z.string().uuid().safeParse(value).success;
}

/**
 * GET /api/invoices/[id]
 * Retrieve an invoice by ID with strict ownership and finance wall checks.
 * - ADMIN: full access within academy
 * - GUARDIAN: permitted only if the invoice belongs to a linked student
 * - STUDENT: permitted only if adult student without guardian and invoice belongs to them;
 *            students with a guardian are rejected with 403 Forbidden
 * - SUPERVISOR: rejected with 403 Forbidden (no financial data access)
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireApiRoles(["ADMIN", "GUARDIAN", "STUDENT"]);
  if (error) return error;

  if (user.role === "STUDENT") {
    try {
      await requireStudentFinanceAccess(user.id);
    } catch {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Students with a guardian cannot access financial operations." } },
        { status: 403 }
      );
    }
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid invoice identifier." } },
      { status: 400 }
    );
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      academyId: true,
      studentId: true,
      amountMinor: true,
      currency: true,
      provider: true,
      packageType: true,
      sessionsPurchased: true,
      status: true,
      createdAt: true,
      paidAt: true,
      student: {
        select: {
          id: true,
          userId: true,
          guardianId: true,
          isAdult: true,
          guardian: { select: { userId: true } },
          user: { select: { displayName: true } },
        },
      },
    },
  });

  if (!invoice || invoice.academyId !== user.academyId) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Invoice was not found." } },
      { status: 404 }
    );
  }

  const isOwner =
    user.role === "ADMIN" ||
    (user.role === "STUDENT" &&
      invoice.student.isAdult &&
      invoice.student.userId === user.id &&
      !invoice.student.guardianId) ||
    (user.role === "GUARDIAN" && invoice.student.guardian?.userId === user.id);

  if (!isOwner) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Access denied." } },
      { status: 403 }
    );
  }

  return NextResponse.json({
    data: {
      ...invoice,
      amountMinor: invoice.amountMinor.toString(),
    },
  });
}
