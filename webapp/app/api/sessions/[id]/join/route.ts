import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { allowRequest } from "../../../../../lib/rate-limit";
import { JOIN_OPENS_BEFORE_START_MS } from "../../../../../lib/config/session-join";
import { validateZoomUrl } from "../../../../../lib/validation/zoom-url";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  if (!allowRequest(`join:${user.id}`, 30, 60 * 1000)) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many join attempts. Try again later." } },
      { status: 429 },
    );
  }
  const { id } = await params;
  const wantsHost = new URL(request.url).searchParams.get("host") === "1";
  const isOperator = user.role === "ADMIN" || user.role === "SUPERVISOR";
  // The host link is for Admin, Supervisor, and the session's assigned teacher only.
  // Students and guardians are answered with the same 404 as for any unknown session,
  // so the existence of a host link is never leaked to them.
  if (wantsHost && (user.role === "STUDENT" || user.role === "GUARDIAN")) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Session not found." } }, { status: 404 });
  }
  const session = await prisma.session.findFirst({
    where: {
      id,
      academyId: user.academyId,
      status: "SCHEDULED",
      // Role scoping mirrors the list route (top-level conditional spreads): the empty
      // OR entry used previously (`OR: [...(operator ? [{}] : [])]`) matches nothing in
      // Prisma's query compiler, which silently broke Admin/Supervisor joins.
      ...(user.role === "TEACHER" ? { teacher: { userId: user.id } } : {}),
      ...(user.role === "STUDENT" ? { students: { some: { student: { userId: user.id } } } } : {}),
      ...(user.role === "GUARDIAN" ? { students: { some: { student: { guardian: { userId: user.id } } } } } : {}),
    },
    select: { id: true, zoomJoinUrl: true, zoomHostUrl: true, scheduledStart: true, scheduledEnd: true },
  });
  if (!session) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Session not found." } }, { status: 404 });
  if (!isOperator) {
    // CONFIRMED join window: opens 15 minutes before the scheduled start, closes at the
    // scheduled end (config constant). Admin/Supervisor are exempt.
    const now = Date.now();
    if (now < session.scheduledStart.getTime() - JOIN_OPENS_BEFORE_START_MS) {
      return NextResponse.json(
        { error: { code: "JOIN_NOT_YET_OPEN", message: "The session join opens 15 minutes before the scheduled start." } },
        { status: 403 },
      );
    }
    if (now > session.scheduledEnd.getTime()) {
      return NextResponse.json(
        { error: { code: "JOIN_WINDOW_CLOSED", message: "The session join window has closed." } },
        { status: 403 },
      );
    }
  }
  const targetUrl = wantsHost ? session.zoomHostUrl : session.zoomJoinUrl;
  if (!targetUrl) {
    return NextResponse.json(
      { error: { code: "NO_HOST_LINK", message: "This session has no host link stored." } },
      { status: 404 },
    );
  }
  // Format check of the stored link (covers legacy non-conforming links) — never echo the link.
  if (!validateZoomUrl(targetUrl).ok) {
    return NextResponse.json(
      { error: { code: "INVALID_ZOOM_URL", message: "The stored session link does not have a valid Zoom format. Ask an Admin to replace it." } },
      { status: 409 },
    );
  }
  // Click evidence (CONTEXT §6 safeguard 5): a row per click with session/user/time only.
  // A failed insert must not block the redirect and must never disclose the link.
  try {
    await prisma.sessionJoinClick.create({ data: { sessionId: session.id, userId: user.id } });
  } catch (cause) {
    console.error(
      "[join] click logging failed.",
      cause instanceof Error ? cause.message : "unknown error",
    );
  }
  return NextResponse.redirect(targetUrl);
}
