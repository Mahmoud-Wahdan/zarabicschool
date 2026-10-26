import "server-only";

import { prisma } from "../prisma";

/** How far back a COMPLETED session still prompts for the optional evaluation. */
export const EVALUATION_PROMPT_WINDOW_DAYS = 7;

/**
 * Post-session prompt (Phase 7, owner 2026-10-26): COMPLETED sessions of this
 * student (or of a guardian's children) that ended within the window and have no
 * evaluation by this user yet. Evaluations are OPTIONAL — this only feeds a card.
 */
export async function countEvaluationPrompts(userId: string, academyId: string, role: "STUDENT" | "GUARDIAN", now = new Date()) {
  const since = new Date(now.getTime() - EVALUATION_PROMPT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rosterFilter = role === "STUDENT" ? { student: { userId } } : { student: { guardian: { userId } } };
  return prisma.session.count({
    where: {
      academyId,
      status: "COMPLETED",
      scheduledEnd: { gte: since, lte: now },
      students: { some: rosterFilter },
      evaluations: { none: { authorUserId: userId } },
    },
  });
}
