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

  if (id.toLowerCase() === user.id.toLowerCase()) {
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

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: {
        id,
        academyId: user.academyId,
        ...(user.role === "SUPERVISOR" ? { role: { not: "ADMIN" as const } } : {}),
      },
      data: {
        sessionVersion: { increment: 1 },
      },
    });
    if (result.count === 0) return false;

    await recordAccountSecurityEvent(tx, {
      academyId: user.academyId,
      actorUserId: user.id,
      targetUserId: id,
      action: "SESSIONS_REVOKED",
    });
    return true;
  });

  if (!updated) return errorResponse(404, "NOT_FOUND", "User not found.");
  return NextResponse.json({ data: { success: true } });
}
