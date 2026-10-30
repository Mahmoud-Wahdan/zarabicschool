import { NextResponse } from "next/server";

import { getScheduleBoard } from "../../../../lib/calendar/board";
import { requireApiRoles } from "../../../../lib/dal";
import { errorResponse } from "../../../../lib/request";
import { zonedYmd } from "../../../../lib/schedules/recurrence";
import { scheduleBoardQuerySchema } from "../../../../lib/validation/schedule-board";

/**
 * GET /api/admin/schedule-board — the teacher schedule board (S-16, D91).
 * Admin and Supervisor only, academy-scoped, viewer zone, no-store. No Zoom link,
 * rate, amount or phone in the answer. `view=week` needs `teacherId`.
 */
export async function GET(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = scheduleBoardQuerySchema.safeParse(params);
  if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "Invalid board filters.");
  if (parsed.data.view === "week" && !parsed.data.teacherId) {
    return errorResponse(400, "VALIDATION_ERROR", "The week view needs one teacher.");
  }
  const timeZone = user.timezone || "Africa/Cairo";
  const data = await getScheduleBoard({
    academyId: user.academyId,
    timeZone,
    date: parsed.data.date ?? zonedYmd(new Date(), timeZone),
    view: parsed.data.view,
    teacherId: parsed.data.teacherId,
    studentId: parsed.data.studentId,
    statuses: parsed.data.status,
  });
  return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
}
