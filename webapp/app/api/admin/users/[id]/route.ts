import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

import { requireApiRole } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { privilegedUserUpdateSchema } from "../../../../../lib/validation/management";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const { id } = await params;
  const parsed = privilegedUserUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid privileged account data.", fields: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }
  if (id === user.id && parsed.data.isActive === false) {
    return NextResponse.json(
      { error: { code: "SELF_LOCKOUT", message: "You cannot deactivate your own account." } },
      { status: 409 },
    );
  }
  if (id === user.id && parsed.data.role && parsed.data.role !== "ADMIN") {
    return NextResponse.json(
      { error: { code: "SELF_DEMOTION", message: "You cannot remove your own SuperAdmin access." } },
      { status: 409 },
    );
  }

  const target = await prisma.user.findFirst({
    where: { id, academyId: user.academyId, role: { in: ["ADMIN", "SUPERVISOR"] } },
    select: { id: true, isActive: true },
  });
  if (!target) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Privileged account not found." } }, { status: 404 });
  }
  const targetRole = (await prisma.user.findFirst({ where: { id }, select: { role: true } }))?.role;
  if ((parsed.data.isActive === false && target.isActive) || (targetRole === "ADMIN" && parsed.data.role === "SUPERVISOR")) {
    const activeAdmins = await prisma.user.count({
      where: { academyId: user.academyId, role: "ADMIN", isActive: true },
    });
    if (activeAdmins <= 1 && targetRole === "ADMIN") {
      return NextResponse.json(
        { error: { code: "LAST_ADMIN", message: "The academy must keep one active SuperAdmin account." } },
        { status: 409 },
      );
    }
  }

  const data = {
    ...(parsed.data.displayName === undefined ? {} : { displayName: parsed.data.displayName }),
    ...(parsed.data.email === undefined ? {} : { email: parsed.data.email || null }),
    ...(parsed.data.phone === undefined ? {} : { phone: parsed.data.phone || null }),
    ...(parsed.data.role === undefined ? {} : { role: parsed.data.role }),
    ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }),
    ...(parsed.data.password === undefined ? {} : { passwordHash: await bcrypt.hash(parsed.data.password, 12) }),
    mustChangePassword: false,
  };
  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, username: true, displayName: true, role: true, isActive: true },
  });
  return NextResponse.json({ data: updated });
}
