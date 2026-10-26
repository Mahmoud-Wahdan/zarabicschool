import { NextResponse } from "next/server";
import { z } from "zod";

import { getComplaintParties } from "../../../../lib/complaints/service";
import { requireApiRoles } from "../../../../lib/dal";
import { errorResponse } from "../../../../lib/request";

/**
 * GET /api/complaints/parties?sessionId= — who the filer may complain about for one
 * of THEIR sessions (names + roles only). 404 when the filer did not take part.
 */
export async function GET(request: Request) {
  const { user, error } = await requireApiRoles(["TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const sessionId = z.guid().safeParse(new URL(request.url).searchParams.get("sessionId"));
  if (!sessionId.success) return errorResponse(400, "VALIDATION_ERROR", "Invalid session identifier.");
  const options = await getComplaintParties(user, sessionId.data);
  if (!options) return errorResponse(404, "NOT_FOUND", "Session not found.");
  return NextResponse.json({
    data: {
      parties: options.parties.map((party) => ({ userId: party.userId, role: party.role, displayName: party.displayName })),
      // A flag only — never who the other participants are.
      otherParticipant: options.otherParticipant,
    },
  });
}
