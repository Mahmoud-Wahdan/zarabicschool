import { NextResponse } from "next/server";
import { z } from "zod";

import { MAX_JOIN_WINDOW_MINUTES, MIN_JOIN_WINDOW_MINUTES } from "../../../../../lib/config/session-join";
import { requireApiRole } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { errorResponse, requireSameOrigin } from "../../../../../lib/request";
import { getJoinWindowMinutes, JOIN_WINDOW_SETTING_KEY } from "../../../../../lib/sessions/join-window";

/**
 * Join window (D4, OQ-4): minutes before the start when the join link opens.
 * GET/PUT — ADMIN only (system settings are not a Supervisor permission, CONTEXT §4).
 * A save re-times, in the same transaction, every PENDING window reminder of a
 * session that has not started yet (owner, 2026-10-27); sent jobs are never touched.
 */
const bodySchema = z.object({
  minutes: z.number().int().min(MIN_JOIN_WINDOW_MINUTES).max(MAX_JOIN_WINDOW_MINUTES),
});

export async function GET() {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  return NextResponse.json({ data: { minutes: await getJoinWindowMinutes(user.academyId) } });
}

export async function PUT(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid join window.", parsed.error.flatten().fieldErrors);
  }
  const { minutes } = parsed.data;
  const retimedReminders = await prisma.$transaction(async (tx) => {
    await tx.academySetting.upsert({
      where: { academyId_key: { academyId: user.academyId, key: JOIN_WINDOW_SETTING_KEY } },
      create: { academyId: user.academyId, key: JOIN_WINDOW_SETTING_KEY, value: minutes },
      update: { value: minutes },
    });
    return tx.$executeRaw`
      UPDATE "notification_jobs" AS j
      SET "scheduled_for" = s."scheduled_start" - make_interval(mins => ${minutes}::int)
      FROM "sessions" AS s
      WHERE j."session_id" = s."id"
        AND j."academy_id" = ${user.academyId}::uuid
        AND j."kind" = 'SESSION_REMINDER'
        AND j."status" = 'PENDING'
        AND s."status" = 'SCHEDULED'
        AND s."scheduled_start" > now()`;
  });
  return NextResponse.json({ data: { minutes, retimedReminders } });
}
