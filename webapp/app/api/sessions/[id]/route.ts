import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { sessionUpdateSchema } from "../../../../lib/validation/management";
import { validateZoomUrl, zoomUrlReasonMessages } from "../../../../lib/validation/zoom-url";

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
  const parsed = sessionUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid session update.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  const data = parsed.data;
  if (data.zoomJoinUrl) {
    const zoomError = zoomUrlErrorResponse(data.zoomJoinUrl);
    if (zoomError) return zoomError;
  }
  if (data.zoomHostUrl) {
    const hostError = zoomUrlErrorResponse(data.zoomHostUrl);
    if (hostError) return hostError;
  }
  const existing = await prisma.session.findFirst({ where: { id, academyId: user.academyId }, select: { id: true, status: true, scheduledStart: true, scheduledEnd: true } });
  if (!existing) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Session not found." } }, { status: 404 });
  if (existing.status === "COMPLETED" || existing.status === "MISSED") {
    return NextResponse.json({ error: { code: "CONFLICT", message: "Completed or missed sessions are immutable." } }, { status: 409 });
  }
  if (existing.status === "CANCELLED" && data.status && data.status !== "CANCELLED") {
    return NextResponse.json({ error: { code: "CONFLICT", message: "Cancelled sessions cannot be reopened." } }, { status: 409 });
  }
  if (data.status && data.status !== existing.status && data.status !== "CANCELLED") {
    return NextResponse.json({ error: { code: "CONFLICT", message: "Only cancellation is supported by this session update." } }, { status: 409 });
  }
  const start = data.scheduledStart ? new Date(data.scheduledStart) : existing.scheduledStart;
  const end = data.scheduledEnd ? new Date(data.scheduledEnd) : existing.scheduledEnd;
  if (end <= start) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Session end must be after its start." } }, { status: 400 });
  const isCancellationTransition = data.status === "CANCELLED" && existing.status !== "CANCELLED";
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.session.update({
      where: { id },
      data: {
        ...data,
        scheduledStart: start,
        scheduledEnd: end,
        durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000),
        zoomHostUrl: data.zoomHostUrl === "" ? null : data.zoomHostUrl,
        cancellationReason: data.cancellationReason === "" ? null : data.cancellationReason,
        cancelledById: isCancellationTransition ? user.id : undefined,
      },
    });
    if (isCancellationTransition) {
      await tx.sessionReservation.updateMany({
        where: { sessionId: id, status: "RESERVED" },
        data: { status: "RELEASED", releasedAt: new Date() },
      });
      await tx.notificationJob.updateMany({
        where: { sessionId: id, status: { in: ["PENDING", "PROCESSING"] } },
        data: { status: "CANCELLED" },
      });
    }
    if (data.scheduledStart && !isCancellationTransition && existing.status === "SCHEDULED") {
      const deltaMs = start.getTime() - existing.scheduledStart.getTime();
      if (deltaMs !== 0) {
        const pendingJobs = await tx.notificationJob.findMany({
          where: { sessionId: id, status: "PENDING" },
          select: { id: true, scheduledFor: true },
        });
        for (const job of pendingJobs) {
          await tx.notificationJob.update({
            where: { id: job.id },
            data: { scheduledFor: new Date(job.scheduledFor.getTime() + deltaMs) },
          });
        }
      }
    }
    return next;
  });
  return NextResponse.json({ data: updated });
}
