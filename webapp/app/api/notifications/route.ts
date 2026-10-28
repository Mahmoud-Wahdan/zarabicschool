import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../lib/dal";
import { getInbox } from "../../../lib/notifications/inbox";

export const runtime = "nodejs";

/** GET /api/notifications — the viewer's inbox (S-06, D12): ids, kinds and links only. */
export async function GET() {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const items = await getInbox(user);
  return NextResponse.json({ data: { items, unread: items.filter((item) => !item.read).length } });
}
