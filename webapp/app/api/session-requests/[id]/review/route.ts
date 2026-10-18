import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { runSerializable } from "../../../../../lib/credits/reservation";
import { createReplacementSession, enqueueReplacementJobs } from "../../../../../lib/scheduling/replacement";
import { SchedulingValidationError } from "../../../../../lib/scheduling/checks";
import { isSessionRequestsReady } from "../../../../../lib/scheduling/session-requests";
import { replacementSessionSchema } from "../../../../../lib/validation/management";
import { validateZoomUrl, zoomUrlReasonMessages } from "../../../../../lib/validation/zoom-url";

const reviewSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  // Owner decision 2026-10-14: the Admin chooses the scope per approval —
  // SESSION = the whole session died (original → MISSED + full replacement);
  // STUDENT = one student absent (group session stays SCHEDULED for the others;
  // the requester's reservation is released + a replacement linked to the original).
  scope: z.enum(["SESSION", "STUDENT"]).optional(),
  studentId: z.string().uuid().optional(),
  replacement: replacementSessionSchema.optional(),
});

function isUuid(value: string) {
  return z.string().uuid().safeParse(value).success;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid request identifier." } }, { status: 400 });
  }
  if (!(await isSessionRequestsReady())) {
    return NextResponse.json(
      { error: { code: "SESSION_REQUESTS_MIGRATION_PENDING", message: "Outage requests are not applied yet. Run the pending migration first." } },
      { status: 409 },
    );
  }
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid review decision.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  const { action } = parsed.data;
  const sessionRequest = await prisma.sessionRequest.findFirst({
    where: { id, academyId: user.academyId },
    select: {
      id: true,
      status: true,
      reason: true,
      requestedBy: { select: { id: true, role: true } },
      session: {
        select: {
          id: true,
          status: true,
          timezone: true,
          teacherId: true,
          subjectId: true,
          sessionType: true,
          teacher: { select: { userId: true } },
          students: { select: { studentId: true, student: { select: { userId: true, guardianId: true } } } },
        },
      },
    },
  });
  if (!sessionRequest) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Request not found." } }, { status: 404 });
  if (sessionRequest.status !== "PENDING") {
    // Repeating the same decision is a clean no-op (report-review pattern).
    if (
      (action === "APPROVE" && sessionRequest.status === "APPROVED") ||
      (action === "REJECT" && sessionRequest.status === "REJECTED")
    ) {
      const full = await prisma.sessionRequest.findUniqueOrThrow({ where: { id } });
      return NextResponse.json({ data: full, alreadyHandled: true });
    }
    return NextResponse.json({ error: { code: "CONFLICT", message: "Only pending requests can be reviewed." } }, { status: 409 });
  }

  if (action === "REJECT") {
    const claimed = await prisma.sessionRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "REJECTED", reviewedById: user.id, reviewedAt: new Date() },
    });
    if (claimed.count === 1) {
      const full = await prisma.sessionRequest.findUniqueOrThrow({ where: { id } });
      return NextResponse.json({ data: full });
    }
    const current = await prisma.sessionRequest.findUniqueOrThrow({ where: { id } });
    if (current.status === "REJECTED") return NextResponse.json({ data: current, alreadyHandled: true });
    return NextResponse.json({ error: { code: "CONFLICT", message: "Only pending requests can be reviewed." } }, { status: 409 });
  }

  // APPROVE — replacement data is mandatory (owner decision 2026-10-14).
  const replacementPayload = parsed.data.replacement;
  if (!replacementPayload) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Replacement session details are required to approve.", fields: { replacement: ["Required."] } } }, { status: 400 });
  }
  const scope = parsed.data.scope ?? "SESSION";
  const start = new Date(replacementPayload.scheduledStart);
  const end = new Date(replacementPayload.scheduledEnd);
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (durationMinutes <= 0 || durationMinutes > 720) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Session duration must be between 1 and 720 minutes." } }, { status: 400 });
  }
  const joinZoom = validateZoomUrl(replacementPayload.zoomJoinUrl);
  if (!joinZoom.ok) {
    return NextResponse.json(
      { error: { code: "INVALID_ZOOM_URL", message: `${zoomUrlReasonMessages[joinZoom.reason]} This is a format check only; it does not verify that the meeting exists.` } },
      { status: 400 },
    );
  }
  if (replacementPayload.zoomHostUrl) {
    const hostZoom = validateZoomUrl(replacementPayload.zoomHostUrl);
    if (!hostZoom.ok) {
      return NextResponse.json(
        { error: { code: "INVALID_ZOOM_URL", message: `${zoomUrlReasonMessages[hostZoom.reason]} This is a format check only; it does not verify that the meeting exists.` } },
        { status: 400 },
      );
    }
  }

  // Resolve the requester's student profile for the per-student scope: an explicit
  // studentId wins; a STUDENT requester maps to their own roster row.
  const rosterIds = sessionRequest.session.students.map((entry) => entry.studentId);
  let requesterStudentId: string | null = parsed.data.studentId ?? null;
  if (!requesterStudentId && sessionRequest.requestedBy.role === "STUDENT") {
    requesterStudentId =
      sessionRequest.session.students.find((entry) => entry.student.userId === sessionRequest.requestedBy.id)?.studentId ?? null;
  }
  if (scope === "STUDENT") {
    if (!requesterStudentId || !rosterIds.includes(requesterStudentId)) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "A student on this session's roster is required for the per-student scope.", fields: { studentId: ["Required."] } } },
        { status: 400 },
      );
    }
    if (!replacementPayload.studentIds.includes(requesterStudentId)) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "The absent student must be included in the replacement session.", fields: { "replacement.studentIds": ["Missing the absent student."] } } },
        { status: 400 },
      );
    }
  }

  const session = sessionRequest.session;
  try {
    const replacement = await runSerializable(async (tx) => {
      const claimed = await tx.sessionRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "APPROVED", reviewedById: user.id, reviewedAt: new Date() },
      });
      if (claimed.count === 0) return null;
      if (scope === "SESSION" && session.status === "SCHEDULED") {
        // The whole session died — mark it MISSED with the request as the reason.
        await tx.session.update({
          where: { id: session.id },
          data: { status: "MISSED", cancellationReason: `Outage/absence request: ${sessionRequest.reason}`.slice(0, 1000) },
        });
      }
      const created = await createReplacementSession(tx, {
        academyId: user.academyId,
        actorId: user.id,
        sourceSessionId: session.id,
        teacherId: replacementPayload.teacherId,
        subjectId: replacementPayload.subjectId,
        sessionType: replacementPayload.sessionType,
        scheduledStart: start,
        scheduledEnd: end,
        timezone: replacementPayload.timezone,
        zoomJoinUrl: replacementPayload.zoomJoinUrl,
        zoomHostUrl: replacementPayload.zoomHostUrl || null,
        studentIds: replacementPayload.studentIds,
        assignmentOverrideReason: replacementPayload.assignmentOverrideReason,
      });
      await tx.sessionRequest.update({ where: { id }, data: { replacementSessionId: created.id } });
      return created;
    });
    if (!replacement) {
      const current = await prisma.sessionRequest.findUniqueOrThrow({ where: { id } });
      if (current.status === "APPROVED") return NextResponse.json({ data: current, alreadyHandled: true });
      return NextResponse.json({ error: { code: "CONFLICT", message: "Only pending requests can be reviewed." } }, { status: 409 });
    }
    // Replacement participants get their reminder/start jobs (Phase 5 review F-12) —
    // after commit; failures never roll the approval back.
    try {
      await enqueueReplacementJobs(replacement.id);
    } catch {
      // Reminder bookkeeping must never fail the review action.
    }
    const full = await prisma.sessionRequest.findUniqueOrThrow({ where: { id } });
    return NextResponse.json({ data: full });
  } catch (cause) {
    if (cause instanceof SchedulingValidationError) {
      return NextResponse.json(
        {
          error: {
            code: cause.code,
            message: cause.message,
            ...(cause.studentIds ? { studentIds: cause.studentIds } : {}),
          },
        },
        { status: 409 },
      );
    }
    throw cause;
  }
}
