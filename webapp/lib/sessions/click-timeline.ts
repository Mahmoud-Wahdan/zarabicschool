import "server-only";

import { prisma } from "../prisma";

/**
 * Session "link click timeline" (Phase 7, owner 2026-10-26) — read-only evidence for
 * ADMIN and SUPERVISOR only (complaint detail + report review). It lists who
 * clicked the platform's Join/Host button, their role and the click time relative to
 * the scheduled start.
 *
 * It is a LINK CLICK TIME, never "arrival" or "attendance": a click does not prove
 * the person entered or stayed in Zoom. Never shown to students, guardians or a
 * complained-about party; never contains or logs a Zoom link (the click table holds
 * session/user/time only).
 *
 * Known gaps (documented in the Phase 7 log): the log does not record join vs host
 * link; links opened from the WhatsApp start message (which carries the join link)
 * are not logged; clicks are only possible while the session is SCHEDULED, from
 * 15 minutes before the start until the scheduled end (Admin/Supervisor any time).
 */
export type ClickTimelineEntry = {
  userId: string;
  displayName: string;
  role: string;
  /** "teacher" when this user is the session's assigned teacher. */
  isAssignedTeacher: boolean;
  clickedAt: string;
  minutesFromStart: number;
};

export async function getClickTimelines(
  viewer: { role: string; academyId: string },
  sessionIds: string[],
): Promise<Map<string, ClickTimelineEntry[]>> {
  const result = new Map<string, ClickTimelineEntry[]>();
  // Server-side guard: the data layer itself refuses any other role.
  if (viewer.role !== "ADMIN" && viewer.role !== "SUPERVISOR") return result;
  const ids = [...new Set(sessionIds)];
  if (!ids.length) return result;
  const sessions = await prisma.session.findMany({
    where: { id: { in: ids }, academyId: viewer.academyId },
    select: {
      id: true,
      scheduledStart: true,
      teacher: { select: { userId: true } },
      joinClicks: {
        orderBy: { clickedAt: "asc" },
        take: 200,
        select: { clickedAt: true, user: { select: { id: true, displayName: true, role: true } } },
      },
    },
  });
  for (const session of sessions) {
    result.set(
      session.id,
      session.joinClicks.map((click) => ({
        userId: click.user.id,
        displayName: click.user.displayName,
        role: click.user.role,
        isAssignedTeacher: click.user.id === session.teacher.userId,
        clickedAt: click.clickedAt.toISOString(),
        minutesFromStart: Math.round((click.clickedAt.getTime() - session.scheduledStart.getTime()) / 60000),
      })),
    );
  }
  return result;
}
