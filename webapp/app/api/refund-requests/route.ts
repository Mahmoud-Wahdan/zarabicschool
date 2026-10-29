import { NextResponse } from "next/server";

import { listRefundRequests } from "../../../lib/billing/refund-requests";
import { requireApiRole } from "../../../lib/dal";

export const runtime = "nodejs";

const STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

/** S-15: the Admin's refund requests (academy-scoped). Money: Admin only, never the Supervisor. */
export async function GET(request: Request) {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const status = new URL(request.url).searchParams.get("status");
  const filter = STATUSES.find((value) => value === status);
  return NextResponse.json({ data: await listRefundRequests(user.academyId, filter) });
}
