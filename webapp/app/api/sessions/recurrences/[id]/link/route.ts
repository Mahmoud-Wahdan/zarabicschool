import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../../lib/dal";
import { prisma } from "../../../../../../lib/prisma";
import { writeLinkAudit } from "../../../../../../lib/scheduling/link-audit";
import { findLinkOverlaps, type LinkOverlapInput } from "../../../../../../lib/scheduling/link-overlap";
import { sessionLinkUpdateSchema } from "../../../../../../lib/validation/management";
import { validateZoomUrl, zoomUrlReasonMessages } from "../../../../../../lib/validation/zoom-url";

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
      { error: { code: "VALIDATION_ERROR", message: "Invalid series link update.", fields: parsed.error.flatten().fieldErrors } },
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
  const nextJoinUrl = data.zoomJoinUrl.trim();
  const nextHostUrl = data.zoomHostUrl ? data.zoomHostUrl.trim() : null;
  const series = await prisma.recurrenceSeries.findFirst({
    where: { id, academyId: user.academyId },
    select: { id: true, status: true },
  });
  if (!series) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Series not found." } }, { status: 404 });

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const fresh = await tx.recurrenceSeries.findUnique({ where: { id }, select: { recurrenceRule: true } });
    if (!fresh) return null;
    // Update the rule too: worker-continued weeks inherit the new link.
    const rule = {
      ...(fresh.recurrenceRule as Record<string, unknown>),
      zoomJoinUrl: nextJoinUrl,
      zoomHostUrl: nextHostUrl,
    };
    await tx.recurrenceSeries.update({ where: { id }, data: { recurrenceRule: rule } });
    // Upcoming = future, non-cancelled: SCHEDULED sessions of this series only.
    const upcoming = await tx.session.findMany({
      where: { recurrenceGroupId: id, status: "SCHEDULED", scheduledStart: { gte: now } },
      select: {
        id: true,
        scheduledStart: true,
        scheduledEnd: true,
        zoomJoinUrl: true,
        zoomHostUrl: true,
      },
    });
    if (upcoming.length > 0) {
      await tx.session.updateMany({
        where: { id: { in: upcoming.map((session) => session.id) } },
        data: { zoomJoinUrl: nextJoinUrl, zoomHostUrl: nextHostUrl },
      });
      for (const session of upcoming) {
        // One audit entry per touched session, WITHOUT the link value.
        await writeLinkAudit(tx, {
          academyId: user.academyId,
          changedById: user.id,
          source: "SERIES",
          joinUrlChanged: session.zoomJoinUrl !== nextJoinUrl,
          hostUrlChanged: session.zoomHostUrl !== nextHostUrl,
          seriesId: id,
          sessionId: session.id,
        });
      }
    } else {
      // Rule-only change (no upcoming session yet): still audited against the series.
      await writeLinkAudit(tx, {
        academyId: user.academyId,
        changedById: user.id,
        source: "SERIES",
        joinUrlChanged: true,
        hostUrlChanged: true,
        seriesId: id,
      });
    }
    return upcoming;
  });
  if (updated === null) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Series not found." } }, { status: 404 });

  // Same-link overlap WARNING (never a block): pairwise check of the updated sessions
  // against every other SCHEDULED session that now shares the join link.
  let warnings: { code: "ZOOM_LINK_OVERLAP"; sessionIds: string[] }[] = [];
  if (updated.length > 0) {
    const starts = updated.map((session) => session.scheduledStart.getTime());
    const ends = updated.map((session) => session.scheduledEnd.getTime());
    const candidates = await prisma.session.findMany({
      where: {
        academyId: user.academyId,
        status: "SCHEDULED",
        zoomJoinUrl: nextJoinUrl,
        id: { notIn: updated.map((session) => session.id) },
        scheduledStart: { lt: new Date(Math.max(...ends)) },
        scheduledEnd: { gt: new Date(Math.min(...starts)) },
      },
      select: { id: true, zoomJoinUrl: true, scheduledStart: true, scheduledEnd: true, status: true },
    });
    const overlap = findLinkOverlaps([...updated, ...candidates] as LinkOverlapInput[]);
    if (overlap) warnings = [overlap];
  }
  return NextResponse.json({
    data: {
      updatedSessions: updated.length,
      warnings,
    },
  });
}
