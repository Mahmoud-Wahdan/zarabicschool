import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { prisma } from "../../../lib/prisma";
import { allowRequest } from "../../../lib/rate-limit";
import { getClientIp } from "../../../lib/request";
import { applicationSchema, normalizeApplication } from "../../../lib/validation/application";

export const runtime = "nodejs";

const maxBodyBytes = 100 * 1024;

function errorResponse(status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) {
  return NextResponse.json({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } }, { status });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBodyBytes) {
    return errorResponse(413, "BODY_TOO_LARGE", "Application is too large.");
  }

  if (!allowRequest(`application:${getClientIp(request.headers)}`)) {
    return errorResponse(429, "RATE_LIMITED", "Too many applications. Try again later.");
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "The request body must be valid JSON.");
  }

  const parsed = applicationSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
    return errorResponse(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", fieldErrors);
  }

  const input = normalizeApplication(parsed.data);
  if (input.honeypot) {
    return NextResponse.json({ id: randomUUID() }, { status: 201 });
  }

  const academy = await prisma.academy.findUnique({ where: { name: "Zarabicschool" } });
  if (!academy) {
    return errorResponse(503, "ACADEMY_NOT_CONFIGURED", "Applications are temporarily unavailable.");
  }

  const duplicate = await prisma.application.findFirst({
    where: {
      academyId: academy.id,
      contactPhone: input.phone_whatsapp,
      applicationType: input.type,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (duplicate) {
    return errorResponse(409, "DUPLICATE_APPLICATION", "A recent application already exists.");
  }

  const application = await prisma.application.create({
    data: {
      academyId: academy.id,
      applicationType: input.type,
      contactPhone: input.phone_whatsapp,
      contactEmail: input.email,
      details: input,
    },
    select: { id: true },
  });

  return NextResponse.json(application, { status: 201 });
}
