import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../../../lib/dal";
import { prisma } from "../../../../../../../lib/prisma";
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../../../../lib/request";
import { recordAccountSecurityEvent } from "../../../../../../../lib/notifications/security-notices";

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
          code: "SELF_REVOCATION_PROHIBITED",
          message: "You cannot revoke your own sessions through this interface.",
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

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        sessionVersion: { increment: 1 },
      },
      select: { id: true },
    });

    await recordAccountSecurityEvent(tx, {
      academyId: user.academyId,
      actorUserId: user.id,
      targetUserId: target.id,
      action: "SESSIONS_REVOKED",
    });
  });

  return NextResponse.json({ data: { success: true } });
}
