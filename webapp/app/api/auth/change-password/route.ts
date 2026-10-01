import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { ZodError } from "zod";

import { prisma } from "../../../../lib/prisma";
import { getAuthSession } from "../../../../lib/dal";
import { allowRequest } from "../../../../lib/rate-limit";
import { changePasswordSchema } from "../../../../lib/validation/auth";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) {
  return NextResponse.json({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } }, { status });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
  }

  const user = await getAuthSession();
  if (!user) {
    return errorResponse(401, "UNAUTHORIZED", "Authentication is required.");
  }

  if (!allowRequest(`change-pw:${user.id}`, 5, 10 * 60 * 1000)) {
    return errorResponse(429, "RATE_LIMITED", "Too many attempts. Try again later.");
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "The request body must be valid JSON.");
  }

  let input: { currentPassword: string; newPassword: string; confirmPassword: string };
  try {
    input = changePasswordSchema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors = error.flatten().fieldErrors as Record<string, string[]>;
      return errorResponse(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", fieldErrors);
    }
    throw error;
  }

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!record) {
    return errorResponse(401, "UNAUTHORIZED", "Authentication is required.");
  }

  const currentValid = await bcrypt.compare(input.currentPassword, record.passwordHash);
  if (!currentValid) {
    return errorResponse(400, "WRONG_CURRENT_PASSWORD", "The current password is incorrect.", {
      currentPassword: ["The current password is incorrect."],
    });
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
