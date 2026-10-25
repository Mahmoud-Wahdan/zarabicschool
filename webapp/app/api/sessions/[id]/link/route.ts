import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { writeLinkAudit } from "../../../../../lib/scheduling/link-audit";
import { sessionLinkUpdateSchema } from "../../../../../lib/validation/management";
import { validateZoomUrl, zoomUrlReasonMessages } from "../../../../../lib/validation/zoom-url";

function zoomUrlErrorResponse(value: string) {
  const result = validateZoomUrl(value);
  if (result.ok) return null;
  return NextResponse.json(
    {
      error: {
        code: "INVALID_ZOOM_URL",
        message: `${zoomUrlReasonMessages[result.reason]} This is a format check only; it does not verify that the meeting exists.`,
      },
    },
    { status: 400 },
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const { id } = await params;
  const parsed = sessionLinkUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid session link update.", fields: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const joinError = zoomUrlErrorResponse(data.zoomJoinUrl);
  if (joinError) return joinError;
  if (data.zoomHostUrl) {
    const hostError = zoomUrlErrorResponse(data.zoomHostUrl);
    if (hostError) return hostError;
  }
  const session = await prisma.session.findFirst({
    where: { id, academyId: user.academyId },
    select: { id: true, status: true, scheduledStart: true, scheduledEnd: true, zoomJoinUrl: true, zoomHostUrl: true },
  });
  if (!session) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Session not found." } }, { status: 404 });
  if (session.status !== "SCHEDULED") {
    return NextResponse.json(
      { error: { code: "SESSION_NOT_SCHEDULED", message: "Links can be edited only on scheduled sessions." } },
      { status: 409 },
    );
  }
  const nextJoinUrl = data.zoomJoinUrl.trim();
  const nextHostUrl = data.zoomHostUrl ? data.zoomHostUrl.trim() : null;
  const joinUrlChanged = nextJoinUrl !== session.zoomJoinUrl;
  const hostUrlChanged = nextHostUrl !== session.zoomHostUrl;
  if (joinUrlChanged || hostUrlChanged) {
    await prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: session.id },
        data: { zoomJoinUrl: nextJoinUrl, zoomHostUrl: nextHostUrl },
      });
      // Audit entry WITHOUT the link value (the URL is never passed to the audit writer).
      await writeLinkAudit(tx, {
        academyId: user.academyId,
        changedById: user.id,
        source: "SESSION",
        joinUrlChanged,
        hostUrlChanged,
        sessionId: session.id,
      });
    });
  }
  // Same-link overlap WARNING (never a block): other SCHEDULED sessions in this academy
  // sharing the join link and overlapping this session's time range.
  const overlapping = await prisma.session.findMany({
    where: {
      academyId: user.academyId,
      status: "SCHEDULED",
      zoomJoinUrl: nextJoinUrl,
      id: { not: session.id },
      scheduledStart: { lt: session.scheduledEnd },
      scheduledEnd: { gt: session.scheduledStart },
    },
    select: { id: true },
  });
  return NextResponse.json({
    data: {
      joinUrlChanged,
      hostUrlChanged,
      warnings: overlapping.length
        ? [{ code: "ZOOM_LINK_OVERLAP", sessionIds: overlapping.map((item) => item.id) }]
        : [],
    },
  });
}
