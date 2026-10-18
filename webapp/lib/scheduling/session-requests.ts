import "server-only";

import { prisma } from "../prisma";

let requestsTableReady = false;
let warnedMissing = false;

/**
 * The session_requests table arrives with migration 20261015*_phase5_session_requests,
 * which the OWNER applies (Phase 3/4 pattern). Until applied, the outage/absence
 * routes answer with a clean "pending migration" conflict and the tests self-deactivate.
 *
 * Only the POSITIVE result is cached: once the owner applies the migration the very
 * next request succeeds — no dev-server restart needed (Phase 5 completion, 2026-10-18).
 * A negative result is re-checked on every call (one cheap to_regclass query) so a
 * long-running server self-heals.
 */
export async function isSessionRequestsReady(): Promise<boolean> {
  if (requestsTableReady) return true;
  try {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT to_regclass('session_requests') AS regclass",
    )) as { regclass: string | null }[];
    requestsTableReady = Boolean(rows[0]?.regclass);
  } catch {
    requestsTableReady = false;
  }
  if (!requestsTableReady && !warnedMissing) {
    warnedMissing = true;
    console.warn(
      "[session-requests] session_requests is not applied yet (migration phase5_session_requests) — outage/absence endpoints return SESSION_REQUESTS_MIGRATION_PENDING until the owner applies it.",
    );
  }
  return requestsTableReady;
}

/**
 * Notify every active Admin and Supervisor about a new outage/absence request
 * (CONTEXT §6: the request lands in the Admin queue). Called AFTER the request row
 * commits; a failure must never roll the request back — the caller wraps this.
 */
export async function enqueueSessionRequestNotifications(requestId: string): Promise<void> {
  const request = await prisma.sessionRequest.findFirst({
    where: { id: requestId },
    select: { id: true, academyId: true, session: { select: { scheduledStart: true, timezone: true, subject: { select: { nameAr: true, nameEn: true } } } } },
  });
  if (!request) return;
  const operators = await prisma.user.findMany({
    where: { academyId: request.academyId, role: { in: ["ADMIN", "SUPERVISOR"] }, isActive: true },
    select: { id: true },
  });
  if (operators.length === 0) return;
  await prisma.notificationJob.createMany({
    data: operators.map((operator) => ({
      academyId: request.academyId,
      sessionId: null,
      recipientUserId: operator.id,
      kind: "SESSION_REQUEST",
      dedupKey: `SESSION_REQUEST:${request.id}:${operator.id}`,
      scheduledFor: new Date(),
    })),
    skipDuplicates: true,
  });
}
