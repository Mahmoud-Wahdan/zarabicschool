import { NextResponse } from "next/server";
import { Prisma } from "../../../generated/prisma/client";

import { requireApiRoles } from "../../../lib/dal";
import { requireStudentFinanceAccess } from "../../../lib/guards/student-finance";
import { prisma } from "../../../lib/prisma";
import { invoiceCreateSchema } from "../../../lib/validation/financial";

/**
 * List invoices with role-based scoping:
 * - ADMIN: all invoices in academy (optional ?studentId)
 * - GUARDIAN: invoices for linked children (optional ?studentId)
 * - STUDENT: adult without guardian only; students with a guardian are rejected with 403
 * - SUPERVISOR: rejected with 403 (no money access)
 */
export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const studentIdParam = searchParams.get("studentId");

  const whereClause: Prisma.InvoiceWhereInput = {
    academyId: user.academyId,
  };

  if (user.role === "STUDENT") {
    const student = await prisma.student.findUnique({
      where: { userId: user.id },
      select: { id: true, guardianId: true, isAdult: true },
    });
    if (!student || student.guardianId || !student.isAdult) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Students with a guardian cannot access financial operations." } },
        { status: 403 }
      );
    }
    whereClause.studentId = student.id;
  } else if (user.role === "GUARDIAN") {
    const guardian = await prisma.guardian.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!guardian) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Guardian not found." } }, { status: 404 });
    }
    whereClause.student = { guardianId: guardian.id };
    if (studentIdParam) {
      whereClause.studentId = studentIdParam;
    }
  } else if (user.role === "ADMIN") {
    if (studentIdParam) {
      whereClause.studentId = studentIdParam;
    }
  }

  const invoices = await prisma.invoice.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
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
          user: { select: { displayName: true } },
        },
      },
    },
  });

  return NextResponse.json({
    data: invoices.map((inv) => ({
      ...inv,
      amountMinor: inv.amountMinor.toString(),
    })),
  });
}

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
