import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRoles } from "../../../../../../lib/dal";
import { prisma } from "../../../../../../lib/prisma";
import { getReportForViewer } from "../../../../../../lib/reports/visibility";
import { getStorageProvider } from "../../../../../../lib/storage";
import { isAttachmentsReady } from "../../../../../../lib/storage/attachment-ready";

const SIGNED_URL_EXPIRES_SECONDS = 300;

function isUuid(value: string) {
  return z.string().uuid().safeParse(value).success;
}

/**
 * Short-lived signed URL for one attachment. Authorization is IDENTICAL to reading
 * the report itself (visibility data layer) — a viewer who cannot see the report
 * gets the same generic 404 as everyone else, with no existence leak.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const { id: reportId, attachmentId } = await params;
  if (!isUuid(reportId) || !isUuid(attachmentId)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid identifier." } }, { status: 400 });
  }
  if (!(await isAttachmentsReady())) {
    return NextResponse.json(
      { error: { code: "ATTACHMENTS_MIGRATION_PENDING", message: "Attachment storage is not applied yet. Ask the Admin to run the pending migration." } },
      { status: 409 },
    );
  }
  const attachment = await prisma.reportAttachment.findFirst({
    where: { id: attachmentId, academyId: user.academyId },
    select: { filePath: true, report: { select: { sessionId: true, studentId: true } } },
  });
  if (!attachment) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Attachment not found." } }, { status: 404 });
  const view = await getReportForViewer(
    { userId: user.id, academyId: user.academyId, role: user.role },
    attachment.report.sessionId,
    attachment.report.studentId,
  );
  if (!view || !view.attachments.some((item) => item.id === attachmentId)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Attachment not found." } }, { status: 404 });
  }
  const provider = getStorageProvider();
  if (!provider) {
    return NextResponse.json(
      { error: { code: "STORAGE_NOT_CONFIGURED", message: "Attachment storage is not configured yet. Ask the Admin to add the Supabase Storage settings." } },
      { status: 409 },
    );
  }
  try {
    const url = await provider.createSignedUrl(attachment.filePath, SIGNED_URL_EXPIRES_SECONDS);
    return NextResponse.json({ data: { url, expiresInSeconds: SIGNED_URL_EXPIRES_SECONDS } });
  } catch {
    return NextResponse.json({ error: { code: "STORAGE_ERROR", message: "The attachment could not be opened. Try again." } }, { status: 502 });
  }
}
