import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRoles } from "../../../../lib/dal";
import { errorResponse, requireSameOrigin } from "../../../../lib/request";
import { applyTimeZone, isValidTimeZone } from "../../../../lib/users/timezone";

const bodySchema = z.object({
  timezone: z.string().max(80),
  // The Admin's choice goes through the profile edit; a user sends DEVICE or USER only.
  source: z.enum(["DEVICE", "USER"]),
});

/** The signed-in user's own time zone (S-03, D3/D39): device detection or their choice. */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isValidTimeZone(parsed.data.timezone)) {
    return errorResponse(400, "VALIDATION_ERROR", "A valid time zone is required.");
  }
  const result = await applyTimeZone(user.id, parsed.data.timezone, parsed.data.source);
  return NextResponse.json({ data: result });
}
