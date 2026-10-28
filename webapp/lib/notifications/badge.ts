import "server-only";

import { prisma } from "../prisma";

/**
 * Family-role ack of notification_jobs (Session 3, slice C). A5 (2026-10-28): the
 * bell count itself now comes from the S-06 inbox (`countUnread`) through the shared
 * BadgeProvider; the old per-role count object (getViewerBadge) was removed with it.
 */

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
