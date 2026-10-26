import { NextResponse } from "next/server";

import { announcementRecipientSummary } from "../../../../lib/announcements/service";
import { requireApiRoles } from "../../../../lib/dal";

/**
 * GET /api/announcements/recipients — the counts the composer shows before the
 * explicit confirmation (ADMIN/SUPERVISOR). Counts only: no names, no numbers.
 */
export async function GET() {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  return NextResponse.json({ data: await announcementRecipientSummary(user.academyId) });
}
