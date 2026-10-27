import { NextResponse } from "next/server";
import { z } from "zod";

import { previewResolution, ResolutionError, resolveAttendance } from "../../../../../../../lib/attendance/resolution";
import { requireApiRoles } from "../../../../../../../lib/dal";
import { isUuidParam, requireSameOrigin } from "../../../../../../../lib/request";

/**
 * S-01 manual attendance resolution (D2, D36, D37). GET = the confirmation screen's
 * exact effect (no write, no money); POST = the resolution itself, which requires
 * `confirm: true` from that screen. Admin and Supervisor only; all rules live in
 * lib/attendance/resolution.ts.
 */
const outcomeSchema = z.enum(["ATTENDED", "STUDENT_ABSENT"]);
const bodySchema = z.object({
  outcome: outcomeSchema,
  reason: z.string().trim().min(5).max(1000),
  confirm: z.boolean(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string; studentId: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const { id: sessionId, studentId } = await params;
  if (!isUuidParam(sessionId) || !isUuidParam(studentId)) return errorResponse("NOT_FOUND", "Session not found.", 404);
  const outcome = outcomeSchema.safeParse(new URL(request.url).searchParams.get("outcome"));
  if (!outcome.success) return errorResponse("VALIDATION_ERROR", "Choose ATTENDED or STUDENT_ABSENT.", 400);
  try {
    const data = await previewResolution({ id: user.id, role: user.role, academyId: user.academyId }, { sessionId, studentId, outcome: outcome.data });
    return NextResponse.json({ data });
  } catch (cause) {
    if (cause instanceof ResolutionError) return errorResponse(cause.code, cause.message, cause.status);
    throw cause;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; studentId: string }> }) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const { id: sessionId, studentId } = await params;
  if (!isUuidParam(sessionId) || !isUuidParam(studentId)) return errorResponse("NOT_FOUND", "Session not found.", 404);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Outcome and a reason of 5–1000 characters are required.", fields: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }
  if (!parsed.data.confirm) {
    return errorResponse("CONFIRMATION_REQUIRED", "Review the effect on the confirmation screen, then confirm.", 400);
  }
  try {
    const result = await resolveAttendance(
      { id: user.id, role: user.role, academyId: user.academyId },
      { sessionId, studentId, outcome: parsed.data.outcome, reason: parsed.data.reason },
    );
    return NextResponse.json({ data: { id: result.resolution.id, outcome: result.resolution.outcome, effect: result.effect } }, { status: 201 });
  } catch (cause) {
    if (cause instanceof ResolutionError) return errorResponse(cause.code, cause.message, cause.status);
    // The unique (session, student) index is the backstop for two concurrent resolutions.
    if ((cause as { code?: string })?.code === "P2002") return errorResponse("ALREADY_RESOLVED", "This student's attendance was already resolved for this session.", 409);
    throw cause;
  }
}
