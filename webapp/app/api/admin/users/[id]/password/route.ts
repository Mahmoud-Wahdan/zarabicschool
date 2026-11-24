import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../../lib/dal";
import { prisma } from "../../../../../../lib/prisma";
import { accountPasswordResetSchema } from "../../../../../../lib/validation/management";
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../../../lib/request";
import { recordAccountSecurityEvent } from "../../../../../../lib/notifications/security-notices";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;

  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid identifier.");

  if (id === user.id) {
    return NextResponse.json(
      {
        error: {
          code: "SELF_RESET_PROHIBITED",
          message: "You cannot reset your own password through this interface. Use personal password change instead.",
        },
      },
      { status: 400 },
    );
  }

  const parsed = accountPasswordResetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid password reset data.",
          fields: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const target = await prisma.user.findFirst({
    where: {
      id,
      academyId: user.academyId,
      ...(user.role === "SUPERVISOR" ? { role: { not: "ADMIN" as const } } : {}),
    },
    select: { id: true, role: true },
  });

  if (!target) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "User not found." } }, { status: 404 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        passwordSetById: user.id,
        passwordSetAt: now,
        sessionVersion: { increment: 1 },
      },
      select: { id: true },
    });

    await recordAccountSecurityEvent(tx, {
      academyId: user.academyId,
      actorUserId: user.id,
      targetUserId: target.id,
      action: "PASSWORD_RESET",
    });
  });

  return NextResponse.json({ data: { success: true } });
}
