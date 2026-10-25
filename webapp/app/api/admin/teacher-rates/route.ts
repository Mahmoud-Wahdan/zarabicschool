import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { teacherRateCreateSchema } from "../../../../lib/validation/financial";

/**
 * Admin-only effective-dated teacher rates (CONTEXT §7: rate storage = the
 * TeacherRates table; one currency per teacher). A session is paid with the row
 * whose effective_from <= the session's scheduled start.
 */
export async function GET() {
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;
  const rates = await prisma.teacherRate.findMany({
    where: { academyId: user.academyId },
    orderBy: [{ teacherId: "asc" }, { effectiveFrom: "desc" }],
    select: {
      id: true,
      teacherId: true,
      hourlyRateMinor: true,
      currency: true,
      effectiveFrom: true,
      createdAt: true,
      teacher: { select: { user: { select: { displayName: true } } } },
    },
    take: 200,
  });
  return NextResponse.json({ data: rates });
}

export async function POST(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;
  const parsed = teacherRateCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid teacher rate.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  const teacher = await prisma.teacher.findFirst({
    where: { id: parsed.data.teacherId, academyId: user.academyId },
    select: { id: true },
  });
  if (!teacher) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Teacher not found." } }, { status: 404 });
  const rate = await prisma.teacherRate.create({
    data: {
      academyId: user.academyId,
      teacherId: teacher.id,
      hourlyRateMinor: parsed.data.hourlyRateMinor,
      currency: parsed.data.currency,
      effectiveFrom: new Date(parsed.data.effectiveFrom),
      createdById: user.id,
    },
    select: { id: true, teacherId: true, hourlyRateMinor: true, currency: true, effectiveFrom: true },
  });
  return NextResponse.json({ data: rate }, { status: 201 });
}
