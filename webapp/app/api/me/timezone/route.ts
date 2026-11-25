import { NextResponse } from "next/server";
import { z } from "zod";

import { runSerializable } from "../../../../lib/credits/reservation";
import { recordAccountSecurityEvent } from "../../../../lib/notifications/security-notices";
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
  const result = await runSerializable(async tx => {
    const result = await applyTimeZone(tx, user.id, parsed.data.timezone, parsed.data.source);
    if (result.changed) {
      await recordAccountSecurityEvent(tx, {
        academyId: user.academyId, actorUserId: user.id, targetUserId: user.id, action: "ACCOUNT_UPDATED",
      });
    }
    return result;
  });
  return NextResponse.json({ data: result });
}
