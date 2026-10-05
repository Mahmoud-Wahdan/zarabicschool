import { NextResponse } from "next/server";

import { prisma } from "../../../../../lib/prisma";
import { requireApiRole } from "../../../../../lib/dal";
import { errorResponse, isSameOrigin } from "../../../../../lib/request";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(_request.headers)) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
  }

  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;

  const { id } = await params;

  const application = await prisma.application.findFirst({
    where: { id, academyId: user.academyId },
    select: { id: true },
  });
  if (!application) {
    return errorResponse(404, "APPLICATION_NOT_FOUND", "Application not found.");
  }

  const claim = await prisma.application.updateMany({
    where: { id: application.id, status: "NEW" },
    data: {
      status: "REVIEWED",
      reviewedById: user.id,
      reviewedAt: new Date(),
    },
  });

  if (claim.count === 0) {
    return errorResponse(409, "ALREADY_PROCESSED", "This application has already been processed.");
  }

  return NextResponse.json({ ok: true });
}
