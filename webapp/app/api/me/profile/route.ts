import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRoles } from "../../../../lib/dal";
import { toInternationalDigits } from "../../../../lib/messaging/phone";
import { prisma } from "../../../../lib/prisma";
import { errorResponse, requireSameOrigin } from "../../../../lib/request";
import { normalizeUsername, usernameSchema } from "../../../../lib/validation/auth";

const phone = z.string().trim().max(40).transform((value, ctx) => {
  if (!value) return null;
  const digits = toInternationalDigits(value);
  if (digits) return `+${digits}`;
  ctx.addIssue({ code: "custom", message: "Invalid WhatsApp number" });
  return z.NEVER;
});

const profile = z.object({
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
    await prisma.user.update({ where: { id: user.id, academyId: user.academyId }, data: parsed.data, select: { id: true } });
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") {
      return errorResponse(409, "USERNAME_TAKEN", "Username is already in use.");
    }
    throw cause;
  }
  return NextResponse.json({ ok: true });
}
