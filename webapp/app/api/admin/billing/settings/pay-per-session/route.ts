import { NextResponse } from "next/server";

import { requireApiRole } from "../../../../../../lib/dal";
import { prisma } from "../../../../../../lib/prisma";
import {
  getPayPerSessionConfig,
  PAY_PER_SESSION_SETTING_PREFIX,
} from "../../../../../../lib/billing/pay-per-session";
import { payPerSessionConfigSchema } from "../../../../../../lib/validation/billing";

/**
 * GET /api/admin/billing/settings/pay-per-session
 * Admin-only: get configured min and max sessions for pay-per-session ("على كيفك").
 */
export async function GET() {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;

  const config = await getPayPerSessionConfig(user.academyId);
  return NextResponse.json({ data: config });
}

/**
 * POST /api/admin/billing/settings/pay-per-session
 * Admin-only: update min and max sessions (min 1, max 16 default — CONTEXT §7.2 / §20.1).
 */
export async function POST(request: Request) {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;

  const parsed = payPerSessionConfigSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid session limits.", fields: parsed.error.flatten().fieldErrors } },
      { status: 400 }
    );
  }

  await prisma.$transaction([
    prisma.academySetting.upsert({
      where: {
        academyId_key: {
          academyId: user.academyId,
          key: `${PAY_PER_SESSION_SETTING_PREFIX}.min`,
        },
      },
      create: {
        academyId: user.academyId,
        key: `${PAY_PER_SESSION_SETTING_PREFIX}.min`,
        value: parsed.data.minSessions.toString(),
      },
      update: {
        value: parsed.data.minSessions.toString(),
      },
    }),
    prisma.academySetting.upsert({
      where: {
        academyId_key: {
          academyId: user.academyId,
          key: `${PAY_PER_SESSION_SETTING_PREFIX}.max`,
        },
      },
      create: {
        academyId: user.academyId,
        key: `${PAY_PER_SESSION_SETTING_PREFIX}.max`,
        value: parsed.data.maxSessions.toString(),
      },
      update: {
        value: parsed.data.maxSessions.toString(),
      },
    }),
  ]);

  return NextResponse.json({
    data: {
      minSessions: parsed.data.minSessions,
      maxSessions: parsed.data.maxSessions,
    },
  });
}
