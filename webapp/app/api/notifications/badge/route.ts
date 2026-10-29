import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
<<<<<<< HEAD
import { ackViewerNotifications } from "../../../../lib/notifications/badge";
import { countUnread } from "../../../../lib/notifications/inbox";
=======
import { ackViewerNotifications, getViewerBadge } from "../../../../lib/notifications/badge";
>>>>>>> a36b92a5884fce32fbf1247ff19460553cbdf488
import { requireSameOrigin } from "../../../../lib/request";

export const runtime = "nodejs";

/**
 * Notification badge (Session 3, slice C): computed SERVER-SIDE, scoped to the
 * logged-in viewer, for the shared shell's bell on every page.
 *  GET  → A5: ONE number, the caller's unread inbox items (S-06), for the shared
 *         badge provider's slow poll; no names, titles or queue details.
 *  POST → family-role ack (sets read_at on the viewer's own jobs; operators have
 *         no per-user read state on team queues).
 */
export async function GET() {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  return NextResponse.json({ data: { count: await countUnread(user) } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const acked = await ackViewerNotifications(user.id);
  return NextResponse.json({ data: { acked } });
}
