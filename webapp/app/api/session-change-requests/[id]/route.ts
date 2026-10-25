import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { changeRequestReviewSchema } from "../../../../lib/validation/management";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = changeRequestReviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid review decision.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  const { id } = await params;
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
