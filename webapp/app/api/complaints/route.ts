import { NextResponse } from "next/server";
import { z } from "zod";

import { COMPLAINT_CATEGORIES, getComplaintParties, OTHER_PARTICIPANT } from "../../../lib/complaints/service";
import { requireApiRoles } from "../../../lib/dal";
import { isPhase7Ready } from "../../../lib/phase7/readiness";
import { prisma } from "../../../lib/prisma";
import { allowRequest } from "../../../lib/rate-limit";
import { errorResponse, requireSameOrigin } from "../../../lib/request";

/**
 * POST /api/complaints — a TEACHER, STUDENT or GUARDIAN files a complaint about a
 * party of a session they took part in (Phase 7, owner 2026-10-26). The response
 * carries no complaint data: only Admin/Supervisor can ever read it, and nobody is
 * notified automatically (in particular never the concerned party).
 */
const createSchema = z.object({
  sessionId: z.guid(),
  // A party's user id, or OTHER_PARTICIPANT ("another participant in this session",
  // unnamed — students/guardians only, when offered).
  concernedUserId: z.union([z.guid(), z.literal(OTHER_PARTICIPANT)]),
  category: z.enum(COMPLAINT_CATEGORIES as [string, ...string[]]),
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(2).max(4000),
});

export async function POST(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  if (!(await isPhase7Ready())) {
    return errorResponse(409, "PHASE7_MIGRATION_PENDING", "Complaints are not available yet.");
  }
  if (!allowRequest(`complaint:${user.id}`, 10, 60 * 60 * 1000)) {
    return errorResponse(429, "RATE_LIMITED", "Too many complaints. Try again later.");
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid complaint.", parsed.error.flatten().fieldErrors);
  }
  const options = await getComplaintParties(user, parsed.data.sessionId);
  // Not a participant of this session, or the session is not in this academy: the
  // same 404 either way (no existence leak).
  if (!options) return errorResponse(404, "NOT_FOUND", "Session not found.");
  const unnamed = parsed.data.concernedUserId === OTHER_PARTICIPANT;
  const concerned = unnamed ? null : options.parties.find((party) => party.userId === parsed.data.concernedUserId);
  if (unnamed ? !options.otherParticipant : !concerned) {
    return errorResponse(400, "VALIDATION_ERROR", "Choose a party of this session.", { concernedUserId: ["Not a party of this session."] });
  }
  await prisma.complaint.create({
    data: {
      academyId: user.academyId,
      sessionId: parsed.data.sessionId,
      filedById: user.id,
      filedByRole: user.role as "TEACHER" | "STUDENT" | "GUARDIAN",
      concernedUserId: concerned?.userId ?? null,
      concernedRole: concerned?.role ?? null,
      category: parsed.data.category as (typeof COMPLAINT_CATEGORIES)[number],
      title: parsed.data.title,
      body: parsed.data.body,
    },
    select: { id: true },
  });
  return NextResponse.json({ data: { received: true } }, { status: 201 });
}
