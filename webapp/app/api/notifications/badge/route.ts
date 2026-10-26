import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { ackViewerNotifications, getViewerBadge } from "../../../../lib/notifications/badge";
import { requireSameOrigin } from "../../../../lib/request";

export const runtime = "nodejs";

/**
 * Notification badge (Session 3, slice C): computed SERVER-SIDE, scoped to the
 * logged-in viewer, for the shared shell's bell on every page.
 *  GET  → the viewer's counts (operators: team queue depths; family roles: their
 *         own unacked notification_jobs).
 *  POST → family-role ack (sets read_at on the viewer's own jobs; operators have
 *         no per-user read state on team queues).
 */
export async function GET() {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const badge = await getViewerBadge(user);
  return NextResponse.json({ data: badge });
}

export async function POST(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const acked = await ackViewerNotifications(user.id);
  return NextResponse.json({ data: { acked } });
}
