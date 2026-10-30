import { NextResponse } from "next/server";
import { z } from "zod";

import { getTeacherHoursThreshold } from "../../../../../lib/calendar/board";
import { MAX_TEACHER_HOURS_THRESHOLD, MIN_TEACHER_HOURS_THRESHOLD, TEACHER_HOURS_THRESHOLD_KEY } from "../../../../../lib/config/schedule-board";
import { requireApiRole } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { errorResponse, requireSameOrigin } from "../../../../../lib/request";

/**
 * Teacher daily-hours threshold of the schedule board (S-16, D91): whole hours 1–16,
 * default 6. GET/PUT — ADMIN only (system settings are not a Supervisor permission,
 * CONTEXT §4); the Supervisor only sees the value inside the board.
 */
const bodySchema = z.object({
  hours: z.number().int().min(MIN_TEACHER_HOURS_THRESHOLD).max(MAX_TEACHER_HOURS_THRESHOLD),
});

export async function GET() {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  return NextResponse.json({ data: { hours: await getTeacherHoursThreshold(user.academyId) } });
}

export async function PUT(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "Invalid threshold.", parsed.error.flatten().fieldErrors);
  await prisma.academySetting.upsert({
    where: { academyId_key: { academyId: user.academyId, key: TEACHER_HOURS_THRESHOLD_KEY } },
    create: { academyId: user.academyId, key: TEACHER_HOURS_THRESHOLD_KEY, value: parsed.data.hours },
    update: { value: parsed.data.hours },
  });
  return NextResponse.json({ data: { hours: parsed.data.hours } });
}
