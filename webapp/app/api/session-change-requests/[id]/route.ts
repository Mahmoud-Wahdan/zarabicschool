import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { changeRequestReviewSchema } from "../../../../lib/validation/management";
<<<<<<< HEAD
import { errorResponse, isUuidParam, requireSameOrigin } from "../../../../lib/request";
=======
import { requireSameOrigin } from "../../../../lib/request";
>>>>>>> a36b92a5884fce32fbf1247ff19460553cbdf488

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid identifier.");
  const parsed = changeRequestReviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid review decision.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  const changeRequest = await prisma.sessionChangeRequest.findFirst({
    where: { id, academyId: user.academyId },
    select: { id: true, status: true },
  });
  if (!changeRequest) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Change request not found." } }, { status: 404 });
  if (changeRequest.status !== "PENDING") {
    return NextResponse.json({ error: { code: "CONFLICT", message: "This change request was already reviewed." } }, { status: 409 });
  }
  const updated = await prisma.sessionChangeRequest.update({
    where: { id },
    data: {
      status: parsed.data.status,
      reviewedById: user.id,
      reviewedAt: new Date(),
    },
    select: { id: true, status: true, reviewedById: true, reviewedAt: true },
  });
  return NextResponse.json({ data: updated });
}
