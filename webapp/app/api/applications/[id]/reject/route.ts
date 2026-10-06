import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "../../../../../lib/prisma";
import { requireApiRoles } from "../../../../../lib/dal";
import { errorResponse, isSameOrigin } from "../../../../../lib/request";

export const runtime = "nodejs";

const rejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Rejection reason is required.")
    .max(1000, "Rejection reason cannot exceed 1000 characters."),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(request.headers)) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
  }

  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "The request body must be valid JSON.");
  }

  const parsed = rejectSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
    return errorResponse(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", fieldErrors);
  }

  const application = await prisma.application.findFirst({
    where: { id, academyId: user.academyId },
    select: { id: true },
  });
  if (!application) {
    return errorResponse(404, "APPLICATION_NOT_FOUND", "Application not found.");
  }

  const claim = await prisma.application.updateMany({
    where: { id: application.id, status: { in: ["NEW", "REVIEWED"] } },
    data: {
      status: "REJECTED",
      reviewedById: user.id,
      reviewedAt: new Date(),
      rejectionReason: parsed.data.reason,
    },
  });

  if (claim.count === 0) {
    return errorResponse(409, "ALREADY_PROCESSED", "This application has already been processed.");
  }

  return NextResponse.json({ ok: true });
}
