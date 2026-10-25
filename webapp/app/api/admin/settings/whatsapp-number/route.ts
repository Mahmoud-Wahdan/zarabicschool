import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRole } from "../../../../../lib/dal";
import { getWhatsAppContactNumber, WHATSAPP_CONTACT_SETTING_KEY } from "../../../../../lib/messaging/contact-number";
import { toInternationalDigits } from "../../../../../lib/messaging/phone";
import { prisma } from "../../../../../lib/prisma";
import { errorResponse, isSameOrigin } from "../../../../../lib/request";

/**
 * Site WhatsApp contact number (wa.me link in the footer + landing page).
 * GET/PUT — ADMIN only (system settings are not a Supervisor permission, CONTEXT §4).
 */
const bodySchema = z.object({
  number: z
    .string()
    .trim()
    .max(32)
    .refine((value) => toInternationalDigits(value) !== null, { message: "Unsupported phone number format." }),
});

export async function GET() {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  return NextResponse.json({ data: { number: await getWhatsAppContactNumber(user.academyId) } });
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request.headers)) return errorResponse(403, "FORBIDDEN", "Cross-origin request rejected.");
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid phone number.", parsed.error.flatten().fieldErrors);
  }
  await prisma.academySetting.upsert({
    where: { academyId_key: { academyId: user.academyId, key: WHATSAPP_CONTACT_SETTING_KEY } },
    create: { academyId: user.academyId, key: WHATSAPP_CONTACT_SETTING_KEY, value: parsed.data.number },
    update: { value: parsed.data.number },
  });
  return NextResponse.json({ data: { number: parsed.data.number } });
}
