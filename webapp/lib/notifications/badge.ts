import "server-only";

import { prisma } from "../prisma";
import { countUnread } from "./inbox";

/**
 * Notification badge (Session 3, slice C — owner decision 2026-10-24): per-viewer
 * counts computed SERVER-SIDE and scoped to the logged-in user, so the bell renders
 * on EVERY page of every role through the shared shell.
 *
 * - ADMIN / SUPERVISOR: the existing operational queue depths (open applications,
 *   SUBMITTED reports, PENDING outage requests), academy-scoped — the same numbers
 *   the dashboards already pass per page, now available everywhere. These are TEAM
 *   queues; they are not "read" per user and never ack.
 * - TEACHER / STUDENT / GUARDIAN: the viewer's OWN notification_jobs that were
 *   delivered (or are queued) and not yet acked (read_at IS NULL). Cleared by the
 *   viewer's own bell ack. BEFORE migration 20261024200000 lands this count is 0
 *   (self-heals once the owner applies it).
 *
 * TEACHER EXCLUSION (owner requirement): a teacher must never receive
 * evaluation-related counts. Evaluation notification jobs DO NOT EXIST anywhere in
 * the system (evaluations enqueue nothing — Session 3 slice B); the kind guard
 * below additionally excludes any future EVALUATION_* kind from every family-role
 * count so the invariant holds even if kinds are added later.
 */

/** Kinds that must never be counted for any viewer are excluded in SQL below
 *  (`NOT (kind LIKE 'EVALUATION%')`) — evaluation jobs do not exist today (slice B
 *  enqueues nothing), and the guard keeps the teacher exclusion structural. */

export type ViewerBadge = {
  applications: number;
  reports: number;
  requests: number;
  notifications: number;
  /** S-06: the viewer's unread inbox items (the bell). */
  inbox: number;
};

export async function getViewerBadge(user: {
  id: string;
  role: "ADMIN" | "SUPERVISOR" | "TEACHER" | "STUDENT" | "GUARDIAN";
  academyId: string;
}): Promise<ViewerBadge> {
  if (user.role === "ADMIN" || user.role === "SUPERVISOR") {
    const [applications, reports, requests] = await Promise.all([
      prisma.application.count({ where: { academyId: user.academyId, status: "NEW" } }),
      prisma.report.count({ where: { academyId: user.academyId, status: "SUBMITTED" } }),
      prisma.sessionRequest.count({ where: { academyId: user.academyId, status: "PENDING" } }),
    ]);
    return { applications, reports, requests, notifications: 0, inbox: await countUnread(user) };
  }

  // Family roles: the viewer's own undelivered/unacked notifications, read_at IS
  // NULL. The read_at column arrives with migration 20261024200000 — until then
  // the raw query matches nothing and answers 0 (no crash, self-heals).
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count
       FROM notification_jobs
      WHERE recipient_user_id = $1::uuid
        AND status IN ('PENDING', 'SENT')
        AND read_at IS NULL
        AND NOT (kind LIKE 'EVALUATION%')`,
    user.id,
  )) as { count: number }[];
  return { applications: 0, reports: 0, requests: 0, notifications: rows[0]?.count ?? 0, inbox: await countUnread(user) };
}

/** Marks the viewer's own unread notifications as seen. Family roles only —
 *  operator queue badges are team queues with no per-user read state. */
export async function ackViewerNotifications(userId: string): Promise<number> {
  try {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE notification_jobs
          SET read_at = NOW()
        WHERE recipient_user_id = $1::uuid
          AND read_at IS NULL
          AND status IN ('PENDING', 'SENT')
          AND NOT (kind LIKE 'EVALUATION%')`,
      userId,
    );
    return result;
  } catch {
    // Pre-migration (no read_at column yet): nothing to ack, never crash the UI.
    return 0;
  }
}
