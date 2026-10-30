import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getRenewalGraceDays,
  MAX_RENEWAL_GRACE_DAYS,
  MIN_RENEWAL_GRACE_DAYS,
  RENEWAL_GRACE_DAYS_KEY,
} from "../../../../../lib/config/renewal-grace";
import { requireApiRole } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { errorResponse, requireSameOrigin } from "../../../../../lib/request";

/**
 * Failed-renewal grace length (CONTEXT §7 "default 3 days, configurable"; D80
 * corrected 2026-10-30): whole days 1–14, default 3. GET/PUT — ADMIN only (system
 * settings are not a Supervisor permission, CONTEXT §4). Applies to graces that start
 * after the save; a grace already running keeps its stored end.
 */
const bodySchema = z.object({
  days: z.number().int().min(MIN_RENEWAL_GRACE_DAYS).max(MAX_RENEWAL_GRACE_DAYS),
});

export async function GET() {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  return NextResponse.json({ data: { days: await getRenewalGraceDays(prisma, user.academyId) } });
}

export async function PUT(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "Invalid grace days.", parsed.error.flatten().fieldErrors);
  await prisma.academySetting.upsert({
    where: { academyId_key: { academyId: user.academyId, key: RENEWAL_GRACE_DAYS_KEY } },
    create: { academyId: user.academyId, key: RENEWAL_GRACE_DAYS_KEY, value: parsed.data.days },
    update: { value: parsed.data.days },
  });
  return NextResponse.json({ data: { days: parsed.data.days } });
}
