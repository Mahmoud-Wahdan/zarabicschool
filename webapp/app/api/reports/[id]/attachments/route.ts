import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireApiRole, requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { getReportForViewer } from "../../../../../lib/reports/visibility";
import { getStorageProvider } from "../../../../../lib/storage";
import { isAttachmentsReady } from "../../../../../lib/storage/attachment-ready";
import { MAX_ATTACHMENT_BYTES, detectAllowedMime } from "../../../../../lib/storage/mime";

const MAX_FILES_PER_REQUEST = 10;

function isUuid(value: string) {
  return z.string().uuid().safeParse(value).success;
}

/** Display-only original filename: strip path components, cap length, never used as a storage path. */
function sanitizeOriginalName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return (base.trim() || "attachment").slice(0, 200);
}

class AttachmentRejection extends Error {
  constructor(readonly status: number, readonly code: string, readonly message: string) {
    super(message);
  }
}

function rejectionResponse(rejection: AttachmentRejection) {
  return NextResponse.json({ error: { code: rejection.code, message: rejection.message } }, { status: rejection.status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const { id: reportId } = await params;
  if (!isUuid(reportId)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid report identifier." } }, { status: 400 });
  }
  const report = await prisma.report.findFirst({ where: { id: reportId, academyId: user.academyId }, select: { sessionId: true, studentId: true } });
  if (!report) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Report not found." } }, { status: 404 });
  const view = await getReportForViewer({ userId: user.id, academyId: user.academyId, role: user.role }, report.sessionId, report.studentId);
  if (!view) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Report not found." } }, { status: 404 });
  return NextResponse.json({ data: view.attachments });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireApiRole("TEACHER");
  if (error) return error;
  const { id: reportId } = await params;
  if (!isUuid(reportId)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid report identifier." } }, { status: 400 });
  }
  if (!(await isAttachmentsReady())) {
    return NextResponse.json(
      { error: { code: "ATTACHMENTS_MIGRATION_PENDING", message: "Attachment storage is not applied yet. Ask the Admin to run the pending migration." } },
      { status: 409 },
    );
  }
  const report = await prisma.report.findFirst({
    where: { id: reportId, academyId: user.academyId },
    select: { id: true, status: true, teacher: { select: { userId: true } } },
  });
  if (!report || report.teacher.userId !== user.id) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Report not found." } }, { status: 404 });
  }
  if (report.status !== "SUBMITTED" && report.status !== "REJECTED") {
    return NextResponse.json({ error: { code: "REPORT_IMMUTABLE", message: "This report has already been approved and can no longer be changed." } }, { status: 409 });
  }
  const provider = getStorageProvider();
  if (!provider) {
    return NextResponse.json(
      { error: { code: "STORAGE_NOT_CONFIGURED", message: "Attachment storage is not configured yet. Ask the Admin to add the Supabase Storage settings." } },
      { status: 409 },
    );
  }
  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "A multipart form with files is required." } }, { status: 400 });
  }
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "At least one file is required.", fields: { files: ["No files uploaded."] } } }, { status: 400 });
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: `A maximum of ${MAX_FILES_PER_REQUEST} files can be uploaded at once.` } }, { status: 400 });
  }

  // Order (documented): the request is ATOMIC — every file uploads to storage first and
  // its DB row is created second; if anything fails, this request's rows are deleted and
  // every object uploaded by this request is removed, so neither orphan rows nor orphan
  // objects survive. The user's filename is never part of the server-generated path.
  const uploadedPaths: string[] = [];
  const createdRowIds: string[] = [];
  try {
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length === 0) {
        throw new AttachmentRejection(400, "VALIDATION_ERROR", "An uploaded file is empty.");
      }
      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        throw new AttachmentRejection(413, "ATTACHMENT_TOO_LARGE", "Each attachment must be 10 MB or smaller.");
      }
      const detected = detectAllowedMime(buffer);
      if (!detected) {
        throw new AttachmentRejection(400, "INVALID_ATTACHMENT_TYPE", "Only images (JPEG, PNG, WebP) and PDF files are allowed.");
      }
      const path = `${user.academyId}/${report.id}/${randomUUID()}.${detected.ext}`;
      await provider.upload({ path, buffer, contentType: detected.mime });
      uploadedPaths.push(path);
      const row = await prisma.reportAttachment.create({
        data: {
          academyId: user.academyId,
          reportId: report.id,
          filePath: path,
          mimeType: detected.mime,
          sizeBytes: BigInt(buffer.length),
          originalName: sanitizeOriginalName(file.name),
        },
      });
      createdRowIds.push(row.id);
    }
  } catch (cause) {
    if (createdRowIds.length > 0) {
      await prisma.reportAttachment
        .deleteMany({ where: { id: { in: createdRowIds } } })
        .catch(() => undefined);
    }
    await Promise.allSettled(uploadedPaths.map((path) => provider.remove(path)));
    if (cause instanceof AttachmentRejection) return rejectionResponse(cause);
    throw cause;
  }
  return NextResponse.json({ data: { uploaded: files.length } }, { status: 201 });
}
