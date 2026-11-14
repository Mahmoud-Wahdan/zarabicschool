import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { prisma } from "../../../lib/prisma";
import { allowRequest } from "../../../lib/rate-limit";
import { errorResponse, getClientIp, requireSameOrigin } from "../../../lib/request";
import { requireApiRoles } from "../../../lib/dal";
import {
  applicationSchema,
  normalizeApplication,
  validateApplicationSubjects,
} from "../../../lib/validation/application";
import { getStorageProvider } from "../../../lib/storage";
import { isApplicationMediaReady } from "../../../lib/storage/application-media-ready";
import { detectAllowedMime, MAX_ATTACHMENT_BYTES } from "../../../lib/storage/mime";
import type { StoredObject } from "../../../lib/storage/provider";

export const runtime = "nodejs";

const maxJsonBytes = 100 * 1024; // 100 KB limit for JSON
const maxMultipartBytes = MAX_ATTACHMENT_BYTES + 1024 * 1024; // 10 MB audio + 1 MB overhead

const validStatuses = new Set(["NEW", "REVIEWED", "APPROVED", "REJECTED"]);
const validTypes = new Set(["GUARDIAN", "STUDENT", "TEACHER"]);

type ApplicationDetails = { full_name?: string };

export async function GET(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN"]);
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
  // The ONE shared origin guard (Host in dev, ALLOWED_ORIGINS in production). The old
  // duplicate "Origin === request.url origin" check refused every request behind a
  // proxy/tunnel, where request.url is internal (review #8, 2026-10-27).
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const contentType = request.headers.get("content-type") || "";
  const isMultipart = contentType.includes("multipart/form-data");
  const maxAllowedBytes = isMultipart ? maxMultipartBytes : maxJsonBytes;

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxAllowedBytes) {
    return errorResponse(413, "BODY_TOO_LARGE", "Application is too large.");
  }

  const clientIp = getClientIp(request.headers);
  if (!allowRequest(`application:${clientIp}`)) {
    return errorResponse(429, "RATE_LIMITED", "Too many applications. Try again later.");
  }

  let raw: unknown;
  let audioFile: File | null = null;

  if (isMultipart) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return errorResponse(400, "INVALID_FORM_DATA", "The request body could not be parsed as form data.");
    }
    const dataStr = formData.get("data");
    if (typeof dataStr !== "string") {
      return errorResponse(400, "INVALID_PAYLOAD", "Form data must contain a 'data' JSON string.");
    }
    try {
      raw = JSON.parse(dataStr);
    } catch {
      return errorResponse(400, "INVALID_JSON", "The 'data' field must be valid JSON.");
    }
    const audioEntry = formData.get("recitation_audio");
    if (audioEntry instanceof File && audioEntry.size > 0) {
      audioFile = audioEntry;
    }
  } else {
    try {
      raw = await request.json();
    } catch {
      return errorResponse(400, "INVALID_JSON", "The request body must be valid JSON.");
    }
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

  // Pre-validate recitation audio if provided
  let audioBuffer: Buffer | null = null;
  let detectedAudioMime: { mime: string; ext: string } | null = null;

  if (audioFile) {
    if (input.type !== "TEACHER") {
      return errorResponse(400, "VALIDATION_ERROR", "Recitation audio is only permitted for teacher applications.");
    }
    if (audioFile.size > MAX_ATTACHMENT_BYTES) {
      return errorResponse(413, "AUDIO_TOO_LARGE", "Recitation audio cannot exceed 10 MB.");
    }
    audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    detectedAudioMime = detectAllowedMime(audioBuffer, "audio");
    if (!detectedAudioMime) {
      return errorResponse(400, "INVALID_AUDIO_TYPE", "Recitation audio must be a valid MP3, M4A, OGG, or WAV audio file.");
    }
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

  // Teacher media readiness check: if migration not applied yet, return 409 APPLICATION_MEDIA_MIGRATION_PENDING
  if (input.type === "TEACHER") {
    const ready = await isApplicationMediaReady();
    if (!ready) {
      return errorResponse(
        409,
        "APPLICATION_MEDIA_MIGRATION_PENDING",
        "Teacher applications are temporarily pending system upgrade."
      );
    }
  }

  // 24-hour duplicate check by normalized phone + application type (runs BEFORE upload)
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

  // Upload audio only after ALL validation, subject check, readiness, and duplicate check pass
  let storedAudio: StoredObject | null = null;
  const storageProvider = getStorageProvider();

  if (audioBuffer && detectedAudioMime) {
    if (!storageProvider) {
      return errorResponse(503, "STORAGE_NOT_CONFIGURED", "File storage is temporarily unavailable.");
    }
    try {
      storedAudio = await storageProvider.upload({
        folder: `${academy.id}/applications/recitations`,
        buffer: audioBuffer,
        contentType: detectedAudioMime.mime,
        ext: detectedAudioMime.ext,
      });
    } catch {
      return errorResponse(500, "UPLOAD_FAILED", "Failed to upload recitation audio. Please try again.");
    }
  }

  // Save the application row (status defaults to NEW in Prisma schema)
  let application;
  try {
    application = await prisma.application.create({
      data: {
        academyId: academy.id,
        applicationType: input.type,
        contactPhone: input.phone_whatsapp,
        contactEmail: input.email,
        details: input,
        introVideoUrl: input.type === "TEACHER" ? input.intro_video_url : null,
        recitationAudioPath: storedAudio?.key ?? null,
        recitationAudioStorageProvider: storedAudio ? storageProvider?.name ?? "cloudinary" : null,
        recitationAudioResourceType: storedAudio?.resourceType ?? null,
        recitationAudioFormat: storedAudio?.format ?? null,
        recitationAudioSizeBytes: storedAudio ? BigInt(storedAudio.bytes) : null,
      },
      select: { id: true },
    });
    } catch (dbError) {
    // Compensation: if DB insert fails after successful upload, delete the object to avoid half-state / orphan
    if (storedAudio && storageProvider) {
      await storageProvider.remove({
        key: storedAudio.key,
        resourceType: storedAudio.resourceType,
        format: storedAudio.format,
      }).catch((removeErr) => {
        console.error("[application] Failed to compensate audio upload after DB error", removeErr);
      });
    }
    return errorResponse(500, "SUBMISSION_FAILED", "Failed to submit application. Please try again.");
  }

  return NextResponse.json(application, { status: 201 });
}
