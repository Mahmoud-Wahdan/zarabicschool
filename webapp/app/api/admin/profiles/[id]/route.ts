import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { isSession1ReportsReady } from "../../../../../lib/reports/session1-ready";
import { profileUpdateSchema } from "../../../../../lib/validation/management";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const { id } = await params;
  const parsed = profileUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid profile data.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  const target = await prisma.user.findFirst({ where: { id, academyId: user.academyId, role: { in: ["GUARDIAN", "STUDENT", "TEACHER"] } }, select: { id: true, role: true } });
  if (!target) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Profile not found." } }, { status: 404 });
  if (target.role === "STUDENT" && parsed.data.guardianId !== undefined && parsed.data.guardianId) {
    const guardian = await prisma.guardian.findFirst({ where: { id: parsed.data.guardianId, academyId: user.academyId }, select: { id: true } });
    if (!guardian) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Guardian not found." } }, { status: 404 });
  }
  // The report_language column arrives with the Session 1 migration (owner applies).
  // Before it lands the selector self-hides and this write is skipped (self-healing).
  const session1Ready = await isSession1ReportsReady();
  const data = {
    ...(parsed.data.displayName === undefined ? {} : { displayName: parsed.data.displayName }),
    ...(parsed.data.phone === undefined ? {} : { phone: parsed.data.phone || null }),
    ...(parsed.data.email === undefined ? {} : { email: parsed.data.email || null }),
    ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }),
  };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data });
    if (target.role === "STUDENT" && parsed.data.guardianId !== undefined) {
      await tx.student.update({
        where: { userId: id },
        data: {
          guardianId: parsed.data.guardianId,
          ...(session1Ready && parsed.data.reportLanguage !== undefined ? { reportLanguage: parsed.data.reportLanguage } : {}),
        },
        select: { id: true },
      });
    }
    if (target.role === "GUARDIAN" && parsed.data.relationship !== undefined) await tx.guardian.update({ where: { userId: id }, data: { relationship: parsed.data.relationship } });
  });
  return NextResponse.json({ data: { id, ...data } });
}
