import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRoles } from "../../../../lib/dal";
import { isInboxKey, markInboxRead } from "../../../../lib/notifications/inbox";
import { errorResponse, requireSameOrigin } from "../../../../lib/request";

export const runtime = "nodejs";

const bodySchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ keys: z.array(z.string()).min(1).max(200) }),
]);

/** POST /api/notifications/read — mark the viewer's own inbox items read (S-06, per-user state). */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || ("keys" in parsed.data && !parsed.data.keys.every(isInboxKey))) {
    return errorResponse(400, "VALIDATION_ERROR", "Send { all: true } or up to 200 valid item keys.");
  }
  const marked = await markInboxRead(user, "all" in parsed.data ? "ALL" : parsed.data.keys);
  return NextResponse.json({ data: { marked } });
}
