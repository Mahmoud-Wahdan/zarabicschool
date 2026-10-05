import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { prisma } from "../../../lib/prisma";
import { allowRequest } from "../../../lib/rate-limit";
import { errorResponse, getClientIp } from "../../../lib/request";
import { requireApiRole } from "../../../lib/dal";
import {
  applicationSchema,
  normalizeApplication,
  validateApplicationSubjects,
} from "../../../lib/validation/application";

export const runtime = "nodejs";

const maxBodyBytes = 100 * 1024; // 100 KB limit

const validStatuses = new Set(["NEW", "REVIEWED", "APPROVED", "REJECTED"]);
const validTypes = new Set(["GUARDIAN", "STUDENT", "TEACHER"]);

type ApplicationDetails = { full_name?: string };

export async function GET(request: Request) {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const typeParam = url.searchParams.get("type");
  const pageParam = Number(url.searchParams.get("page") || "1");
  const pageSizeParam = Number(url.searchParams.get("pageSize") || "20");
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;
  const pageSize =
    Number.isFinite(pageSizeParam) && pageSizeParam >= 1
      ? Math.min(50, Math.floor(pageSizeParam))
      : 20;

  const where = {
    academyId: user.academyId,
    ...(statusParam && validStatuses.has(statusParam) ? { status: statusParam as never } : {}),
    ...(typeParam && validTypes.has(typeParam) ? { applicationType: typeParam as never } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.application.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        applicationType: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
        contactPhone: true,
        details: true,
      },
    }),
    prisma.application.count({ where }),
  ]);

  const applications = rows.map((row) => {
    const details = row.details as ApplicationDetails | null;
    return {
      id: row.id,
      applicationType: row.applicationType,
      fullName: details?.full_name ?? "",
      status: row.status,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
      contactPhone: row.contactPhone,
    };
  });

  return NextResponse.json({
    applications,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (origin !== new URL(request.url).origin) {
        return errorResponse(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
      }
    } catch {
      return errorResponse(403, "ORIGIN_NOT_ALLOWED", "Invalid request origin.");
    }
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBodyBytes) {
    return errorResponse(413, "BODY_TOO_LARGE", "Application is too large.");
  }

  const clientIp = getClientIp(request.headers);
  if (!allowRequest(`application:${clientIp}`)) {
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

  // Honeypot field: silent fake success if filled
  if (input.honeypot) {
    return NextResponse.json({ id: randomUUID() }, { status: 201 });
  }

  const academy = await prisma.academy.findUnique({
    where: { name: "Zarabicschool" },
  });
  if (!academy) {
    return errorResponse(503, "ACADEMY_NOT_CONFIGURED", "Applications are temporarily unavailable.");
  }

  // Validate subjects against active subjects in the database
  const activeSubjects = await prisma.subject.findMany({
    where: { academyId: academy.id, isActive: true },
    select: { id: true, slug: true },
  });
  const allowedSubjectSet = new Set([
    ...activeSubjects.map((s) => s.slug),
    ...activeSubjects.map((s) => s.id),
  ]);

  const subjectValidation = validateApplicationSubjects(parsed.data, allowedSubjectSet);
  if (!subjectValidation.valid) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "One or more selected subjects are not recognized.",
      subjectValidation.fieldErrors
    );
  }

  // 24-hour duplicate check by normalized phone + application type
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
    return errorResponse(409, "DUPLICATE_APPLICATION", "An application with this phone number was recently submitted.");
  }

  // Save the application row (status defaults to NEW in Prisma schema)
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
