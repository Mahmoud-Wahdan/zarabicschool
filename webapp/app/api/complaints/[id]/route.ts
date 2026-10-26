import { NextResponse } from "next/server";
import { z } from "zod";

import { nextComplaintStatus } from "../../../../lib/complaints/service";
import { requireApiRoles } from "../../../../lib/dal";
import { isPhase7Ready } from "../../../../lib/phase7/readiness";
import { prisma } from "../../../../lib/prisma";
import { errorResponse, requireSameOrigin } from "../../../../lib/request";

/**
 * PATCH /api/complaints/:id — ADMIN/SUPERVISOR move a complaint forward:
 * NEW → IN_PROGRESS ("START"), IN_PROGRESS → RESOLVED ("RESOLVE", note required).
 * Conditional update on the expected status (a double click or a concurrent
 * handler cannot skip or repeat a step). No notification to anyone.
 */
const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("START") }),
  z.object({ action: z.literal("RESOLVE"), resolutionNote: z.string().trim().min(2).max(4000) }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  if (!(await isPhase7Ready())) return errorResponse(409, "PHASE7_MIGRATION_PENDING", "Complaints are not available yet.");
  const { id } = await params;
  if (!z.guid().safeParse(id).success) return errorResponse(400, "VALIDATION_ERROR", "Invalid complaint identifier.");
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "Invalid action.", parsed.error.flatten().fieldErrors);

  const complaint = await prisma.complaint.findFirst({ where: { id, academyId: user.academyId }, select: { id: true, status: true } });
  if (!complaint) return errorResponse(404, "NOT_FOUND", "Complaint not found.");
  const expected = parsed.data.action === "START" ? "NEW" : "IN_PROGRESS";
  const target = nextComplaintStatus(expected);
  if (complaint.status !== expected || !target) {
    return errorResponse(409, "INVALID_TRANSITION", `The complaint is ${complaint.status}.`);
  }
  const now = new Date();
  const updated = await prisma.complaint.updateMany({
    where: { id, academyId: user.academyId, status: expected },
    data:
      parsed.data.action === "START"
        ? { status: "IN_PROGRESS", handledById: user.id }
        : { status: "RESOLVED", handledById: user.id, resolutionNote: parsed.data.resolutionNote, resolvedAt: now },
  });
  if (updated.count !== 1) return errorResponse(409, "INVALID_TRANSITION", "The complaint was already updated.");
  return NextResponse.json({ data: { id, status: target } });
}
