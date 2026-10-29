import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

import { requireApiRole } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { privilegedUserUpdateSchema } from "../../../../../lib/validation/management";
<<<<<<< HEAD
import { requireSameOrigin, isUuidParam, errorResponse } from "../../../../../lib/request";
=======
import { requireSameOrigin } from "../../../../../lib/request";
>>>>>>> a36b92a5884fce32fbf1247ff19460553cbdf488

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid identifier.");
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
    // B4 (S9): a password set by ANOTHER Admin forces a change at next login; an
    // Admin editing their own account keeps it. Other edits never touch the flag
    // (previously every edit cleared it).
    ...(parsed.data.password === undefined
      ? {}
      : {
          passwordHash: await bcrypt.hash(parsed.data.password, 12),
          mustChangePassword: id !== user.id,
          passwordSetById: user.id,
          passwordSetAt: new Date(),
        }),
  };
  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, username: true, displayName: true, role: true, isActive: true },
  });
  return NextResponse.json({ data: updated });
}
