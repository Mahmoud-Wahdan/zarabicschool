import { NextResponse } from "next/server";

import { routing, type AppLocale } from "../../../../../i18n/routing";
import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { allowRequest } from "../../../../../lib/rate-limit";
import { getJoinWindowMinutes } from "../../../../../lib/sessions/join-window";
import { platformUrl } from "../../../../../lib/config/platform-url";
import { validateZoomUrl } from "../../../../../lib/validation/zoom-url";
import { isUuidParam } from "../../../../../lib/request";

// I-1 (owner, 2026-10-27): this URL is opened from WhatsApp in a browser. Browsers
// (Accept: text/html) are redirected to readable pages on the PUBLIC origin
// (APP_PUBLIC_URL, never the internal request host); API callers keep the JSON codes.
function wantsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function requestLocale(request: Request): AppLocale {
  const match = /(?:^|;\s*)NEXT_LOCALE=(ar|en)(?:;|$)/.exec(request.headers.get("cookie") ?? "");
  return (match?.[1] as AppLocale | undefined) ?? routing.defaultLocale;
}

function publicRedirect(request: Request, path: string) {
  return NextResponse.redirect(platformUrl(path) ?? new URL(path, request.url).toString());
}

function joinError(request: Request, status: number, code: string, message: string) {
  if (wantsHtml(request)) {
    return publicRedirect(request, `/${requestLocale(request)}/join-status?reason=${encodeURIComponent(code)}`);
  }
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wantsHost = new URL(request.url).searchParams.get("host") === "1";
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  // A signed-out reader goes to the login page and comes back to this session.
  if (error?.status === 401) {
    const login = new URLSearchParams();
    if (isUuidParam(id)) login.set("callbackUrl", `/api/sessions/${id}/join${wantsHost ? "?host=1" : ""}`);
    const query = login.toString();
    return publicRedirect(request, `/${requestLocale(request)}/login${query ? `?${query}` : ""}`);
  }
  if (error) return error;
  if (!allowRequest(`join:${user.id}`, 30, 60 * 1000)) {
    return joinError(request, 429, "RATE_LIMITED", "Too many join attempts. Try again later.");
  }
  // Same generic 404 as an unknown session (never a 500, never an existence oracle).
  if (!isUuidParam(id)) return joinError(request, 404, "NOT_FOUND", "Session not found.");
  const isOperator = user.role === "ADMIN" || user.role === "SUPERVISOR";
  // The host link is for Admin, Supervisor, and the session's assigned teacher only.
  // Students and guardians are answered with the same 404 as for any unknown session,
  // so the existence of a host link is never leaked to them.
  if (wantsHost && (user.role === "STUDENT" || user.role === "GUARDIAN")) {
    return joinError(request, 404, "NOT_FOUND", "Session not found.");
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
  if (!session) return joinError(request, 404, "NOT_FOUND", "Session not found.");
  if (!isOperator) {
    // Join window (D4): opens the Admin-set number of minutes before the scheduled
    // start (default 30), closes at the scheduled end. Admin/Supervisor are exempt.
    const windowMinutes = await getJoinWindowMinutes(user.academyId);
    const now = Date.now();
    if (now < session.scheduledStart.getTime() - windowMinutes * 60 * 1000) {
      return joinError(request, 403, "JOIN_NOT_YET_OPEN", `The session join opens ${windowMinutes} minutes before the scheduled start.`);
    }
    if (now > session.scheduledEnd.getTime()) {
      return joinError(request, 403, "JOIN_WINDOW_CLOSED", "The session join window has closed.");
    }
  }
  // D32 (owner, 2026-10-27): the assigned teacher (the query above already scopes a
  // TEACHER to own sessions) opens the host link when one is stored, else the join link.
  const teacherHost = user.role === "TEACHER" && session.zoomHostUrl ? session.zoomHostUrl : null;
  const targetUrl = wantsHost ? session.zoomHostUrl : (teacherHost ?? session.zoomJoinUrl);
  if (!targetUrl) {
    return joinError(request, 404, "NO_HOST_LINK", "This session has no host link stored.");
  }
  // Format check of the stored link (covers legacy non-conforming links) — never echo the link.
  if (!validateZoomUrl(targetUrl).ok) {
    return joinError(request, 409, "INVALID_ZOOM_URL", "The stored session link does not have a valid Zoom format. Ask an Admin to replace it.");
  }
  // Click evidence (CONTEXT §6 safeguard 5): a row per click with session/user/time only.
  // A failed insert must not block the redirect and must never disclose the link.
  try {
    await prisma.sessionJoinClick.create({ data: { academyId: user.academyId, sessionId: session.id, userId: user.id } });
  } catch (cause) {
    console.error(
      "[join] click logging failed.",
      cause instanceof Error ? cause.message : "unknown error",
    );
  }
  return NextResponse.redirect(targetUrl);
}
