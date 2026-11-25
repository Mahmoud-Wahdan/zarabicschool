import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRoles } from "../../../../lib/dal";
import { toInternationalDigits } from "../../../../lib/messaging/phone";
import { runSerializable } from "../../../../lib/credits/reservation";
import { accountFieldsChanged, recordAccountUpdate, sendPhoneChangeNotice } from "../../../../lib/notifications/security-notices";
import { errorResponse, requireSameOrigin } from "../../../../lib/request";
import { normalizeUsername, usernameSchema } from "../../../../lib/validation/auth";

import { isValidBirthDate, resolveAdultStatus } from "../../../../lib/validation/birth-date";

const phone = z.string().trim().max(40).transform((value, ctx) => {
  if (!value) return null;
  const digits = toInternationalDigits(value);
  if (digits) return `+${digits}`;
  ctx.addIssue({ code: "custom", message: "Invalid WhatsApp number" });
  return z.NEVER;
});

const profile = z.object({
  dateOfBirth: z.string().refine(value => value === "" || isValidBirthDate(value)).transform(value => value ? new Date(value + "T00:00:00Z") : null),
  displayName: z.string().trim().min(1).max(120),
  username: usernameSchema.transform(normalizeUsername),
  email: z.union([z.literal(""), z.string().trim().email().max(254)]).transform(value => value || null),
  phone,
  preferredLanguage: z.enum(["ar", "en"]),
}).partial().strict();

export async function PATCH(request: Request) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const parsed = profile.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { fields: parsed.error.issues.map(issue => issue.path[0]) } }, { status: 400 });
  }
  if (!Object.keys(parsed.data).length) return errorResponse(400, "EMPTY", "No profile changes.");
  try {
    const result = await runSerializable(async tx => {
      const current = await tx.user.findUniqueOrThrow({
        where: { id: user.id, academyId: user.academyId },
        select: { id: true, displayName: true, username: true, dateOfBirth: true, email: true, phone: true, preferredLanguage: true },
      });
      if (!accountFieldsChanged(current, parsed.data)) return null;
      await tx.user.update({
        where: { id: user.id, academyId: user.academyId },
        data: parsed.data,
        select: { id: true },
      });

      if (user.role === "STUDENT" && parsed.data.dateOfBirth !== undefined) {
        const student = await tx.student.findUniqueOrThrow({
          where: { userId: user.id },
          select: { isAdult: true, guardianId: true },
        });
        const isAdult = resolveAdultStatus(parsed.data.dateOfBirth, student.isAdult);
        if (!isAdult && !student.guardianId) throw new GuardianRequired();
        await tx.student.update({
          where: { userId: user.id },
          data: {
            isAdult,
          },
          select: { id: true },
        });
      }
      return recordAccountUpdate(tx, user, current, parsed.data);
    });
    const whatsappDelivery = result ? (await sendPhoneChangeNotice(result)).status : undefined;
    return NextResponse.json({ ok: true, whatsappDelivery });
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") {
      return errorResponse(409, "USERNAME_TAKEN", "Username is already in use.");
    }
    if (cause instanceof GuardianRequired) return errorResponse(409, "GUARDIAN_REQUIRED", "A minor student needs a guardian.");
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2034") {
      return errorResponse(409, "CONFLICT", "The profile changed. Refresh and try again.");
    }
    throw cause;
  }
}

class GuardianRequired extends Error {}
