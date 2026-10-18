import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRoles } from "../../../../../lib/dal";
import { allowRequest } from "../../../../../lib/rate-limit";
import { prisma } from "../../../../../lib/prisma";
import { enqueueSessionRequestNotifications, isSessionRequestsReady } from "../../../../../lib/scheduling/session-requests";

const sessionRequestSchema = z.object({
  reason: z.string().trim().min(2).max(1000),
});

function isUuid(value: string) {
  return z.string().uuid().safeParse(value).success;
}

/**
 * "أبلغ عن عطل" — an outage/absence request on one session, by the STUDENT
 * (own roster row), the GUARDIAN (a child's roster row) or the assigned TEACHER.
 * Rate-limited, reason required, and one OPEN request per (session, requester)
 * (partial unique index; a reviewed request never blocks a new one).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["STUDENT", "GUARDIAN", "TEACHER"]);
  if (error) return error;
  const { id: sessionId } = await params;
  if (!isUuid(sessionId)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid session identifier." } }, { status: 400 });
  }
  if (!allowRequest(`session-request:${user.id}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many outage requests. Try again later." } }, { status: 429 });
  }
  if (!(await isSessionRequestsReady())) {
    return NextResponse.json(
      { error: { code: "SESSION_REQUESTS_MIGRATION_PENDING", message: "Outage requests are not applied yet. Ask the Admin to run the pending migration." } },
      { status: 409 },
    );
  }
  const parsed = sessionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "A reason is required.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  const session = await prisma.session.findFirst({
    where: { id: sessionId, academyId: user.academyId },
    select: { id: true, status: true, teacher: { select: { userId: true } } },
  });
  if (!session) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Session not found." } }, { status: 404 });
  if (session.status !== "SCHEDULED" && session.status !== "COMPLETED") {
    return NextResponse.json({ error: { code: "SESSION_NOT_REQUESTABLE", message: "Outage requests apply to sessions that take place." } }, { status: 409 });
  }
  if (user.role === "TEACHER") {
    if (session.teacher.userId !== user.id) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Session not found." } }, { status: 404 });
    }
  } else {
    // Student: own roster row. Guardian: any linked child's roster row on this session.
    const roster = await prisma.sessionStudent.findFirst({
      where: {
        sessionId,
        ...(user.role === "STUDENT"
          ? { student: { userId: user.id } }
          : { student: { guardian: { userId: user.id } } }),
      },
      select: { id: true },
    });
    if (!roster) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Session not found." } }, { status: 404 });
  }

  let created;
  try {
    created = await prisma.sessionRequest.create({
      data: { academyId: user.academyId, sessionId, requestedById: user.id, reason: parsed.data.reason },
      select: { id: true, status: true, createdAt: true },
    });
  } catch (cause) {
    // One OPEN request per (session, requester) — a second open request is a clean 409.
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") {
      return NextResponse.json({ error: { code: "ALREADY_REQUESTED", message: "You already have an open request for this session." } }, { status: 409 });
    }
    throw cause;
  }

  // Notify Admin/Supervisor AFTER commit; failures never roll the request back.
  try {
    await enqueueSessionRequestNotifications(created.id);
  } catch {
    // Notification bookkeeping must never fail an accepted request.
  }
  return NextResponse.json({ data: created }, { status: 201 });
}
