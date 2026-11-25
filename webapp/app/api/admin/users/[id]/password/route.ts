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

  if (id.toLowerCase() === user.id.toLowerCase()) {
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

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: {
        id,
        academyId: user.academyId,
        ...(user.role === "SUPERVISOR" ? { role: { not: "ADMIN" as const } } : {}),
      },
      data: {
        passwordHash,
        mustChangePassword: true,
        passwordSetById: user.id,
        passwordSetAt: now,
        sessionVersion: { increment: 1 },
      },
    });
    if (result.count === 0) return false;

    await recordAccountSecurityEvent(tx, {
      academyId: user.academyId,
      actorUserId: user.id,
      targetUserId: id,
      action: "PASSWORD_RESET",
    });
    return true;
  });

  if (!updated) return errorResponse(404, "NOT_FOUND", "User not found.");
  return NextResponse.json({ data: { success: true } });
}
