import "server-only";

import { prisma } from "../prisma";

/**
 * Session evaluations (Session 3, owner decision 2026-10-24 —
 * docs/specs/phase-06-financial-management.md § Session 3, Slice B).
 *
 * Rules locked by the owner:
 * - The STUDENT and the GUARDIAN each evaluate the session/teacher: rating 1..5 +
 *   optional comment.
 * - ONE evaluation per (session, author) — including group sessions and a guardian
 *   with several children in the same session (UNIQUE(session_id, author_user_id)).
 * - Editable for 24h after creation, then locked (server-enforced here).
 * - THE TEACHER NEVER SEES IT: nothing in this module is importable by a teacher
 *   flow, no notification is enqueued, and every read path below is restricted to
 *   the author themself or Admin/Supervisor. Nothing here is ever anonymised and
 *   shown to the teacher — there is no such endpoint at all.
 * - Admin AND Supervisor read (the owner's newest decision — the relaying role —
 *   superseding the older CONTEXT §9 "Admin-only" line).
 */

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

let evaluationsTableReady: boolean | null = null;

/** True once the owner applies migration 20261024100000 (session_evaluations table). */
export async function isEvaluationsReady(): Promise<boolean> {
  if (evaluationsTableReady === true) return true;
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'session_evaluations'",
  )) as { count: number }[];
  evaluationsTableReady = rows[0]?.count === 1;
  return evaluationsTableReady;
}

export type EvaluationAuthor = {
  userId: string;
  role: "STUDENT" | "GUARDIAN";
};

export type EvaluationView = {
  id: string;
  rating: number;
  comment: string | null;
  authorType: "STUDENT" | "GUARDIAN";
  authorUserId: string;
  createdAt: Date;
  updatedAt: Date;
  editableUntil: Date;
  locked: boolean;
};

export class EvaluationError extends Error {
  constructor(
    readonly code: "NOT_READY" | "NOT_ON_ROSTER" | "SESSION_NOT_EVALUABLE" | "LOCKED" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "EvaluationError";
  }
}

function toView(row: {
  id: string;
  rating: number;
  comment: string | null;
  authorType: "STUDENT" | "GUARDIAN";
  authorUserId: string;
  createdAt: Date;
  updatedAt: Date;
}): EvaluationView {
  const editableUntil = new Date(row.createdAt.getTime() + EDIT_WINDOW_MS);
  return { ...row, editableUntil, locked: Date.now() >= editableUntil.getTime() };
}

/**
 * The author's eligibility context for ONE session: the roster anchor (the
 * authoring student, or the guardian's first roster child) and the session's
 * evaluability (ended, not cancelled/missed). Throws typed errors the route maps
 * to coded responses — a non-roster author gets the generic 404 upstream.
 */
async function resolveEligibility(sessionId: string, author: EvaluationAuthor) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId },
    select: {
      id: true,
      academyId: true,
      status: true,
      scheduledEnd: true,
    },
  });
  if (!session) throw new EvaluationError("NOT_ON_ROSTER", "Session not found.");
  if (session.status === "CANCELLED" || session.status === "MISSED") {
    throw new EvaluationError("SESSION_NOT_EVALUABLE", "A session that did not take place cannot be evaluated.");
  }
  if (new Date() < session.scheduledEnd) {
    throw new EvaluationError("SESSION_NOT_EVALUABLE", "The session can be evaluated after it ends.");
  }

  if (author.role === "STUDENT") {
    const roster = await prisma.sessionStudent.findFirst({
      where: { sessionId, student: { userId: author.userId } },
      select: { studentId: true },
    });
    if (!roster) throw new EvaluationError("NOT_ON_ROSTER", "Student is not on this session's roster.");
    return { academyId: session.academyId, studentId: roster.studentId };
  }

  // GUARDIAN: linked to at least one roster student of the session. With several
  // children on the same roster the anchor is the first (deterministic by their
  // roster creation) — the evaluation itself remains ONE per (session, author).
  const roster = await prisma.sessionStudent.findFirst({
    where: { sessionId, student: { guardian: { userId: author.userId } } },
    select: { studentId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!roster) throw new EvaluationError("NOT_ON_ROSTER", "Guardian has no child on this session's roster.");
  return { academyId: session.academyId, studentId: roster.studentId };
}

/** The caller's own evaluation for the session (null when none). Students and guardians only. */
export async function getOwnEvaluation(sessionId: string, author: EvaluationAuthor): Promise<EvaluationView | null> {
  if (!(await isEvaluationsReady())) return null;
  const row = await prisma.sessionEvaluation.findFirst({
    where: { sessionId, authorUserId: author.userId },
    select: {
      id: true,
      rating: true,
      comment: true,
      authorType: true,
      authorUserId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return row ? toView(row) : null;
}

/** The caller's own evaluations for several sessions at once (list pages). Author-scoped only. */
export async function getOwnEvaluationsForSessions(
  sessionIds: string[],
  author: EvaluationAuthor,
): Promise<Map<string, EvaluationView>> {
  if (sessionIds.length === 0 || !(await isEvaluationsReady())) return new Map();
  const rows = await prisma.sessionEvaluation.findMany({
    where: { sessionId: { in: sessionIds }, authorUserId: author.userId },
    select: {
      id: true,
      sessionId: true,
      rating: true,
      comment: true,
      authorType: true,
      authorUserId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return new Map(rows.map(({ sessionId, ...row }) => [sessionId, toView(row)]));
}

/**
 * Create or update the author's evaluation within the 24h window. Idempotent under
 * concurrent first-submits: the P2002 loser re-reads and continues down the update
 * path (still inside the window) instead of erroring. `created` tells the caller
 * which happened (201 vs 200) — comparing createdAt/updatedAt cannot: they are Date
 * objects and come from different clocks (DB default vs client @updatedAt).
 */
export async function submitEvaluation(
  sessionId: string,
  author: EvaluationAuthor,
  input: { rating: number; comment: string | null },
): Promise<{ view: EvaluationView; created: boolean }> {
  if (!(await isEvaluationsReady())) {
    throw new EvaluationError("NOT_READY", "Evaluations storage is not applied yet.");
  }
  const eligibility = await resolveEligibility(sessionId, author);

  const existing = await prisma.sessionEvaluation.findFirst({
    where: { sessionId, authorUserId: author.userId },
    select: { id: true, createdAt: true },
  });
  if (existing && Date.now() >= existing.createdAt.getTime() + EDIT_WINDOW_MS) {
    throw new EvaluationError("LOCKED", "The 24h evaluation window has closed.");
  }

  const authorType = author.role;
  try {
    const row = existing
      ? await prisma.sessionEvaluation.update({
          where: { id: existing.id },
          data: { rating: input.rating, comment: input.comment },
          select: { id: true, rating: true, comment: true, authorType: true, authorUserId: true, createdAt: true, updatedAt: true },
        })
      : await prisma.sessionEvaluation.create({
          data: {
            academyId: eligibility.academyId,
            sessionId,
            studentId: eligibility.studentId,
            authorUserId: author.userId,
            authorType,
            rating: input.rating,
            comment: input.comment,
          },
          select: { id: true, rating: true, comment: true, authorType: true, authorUserId: true, createdAt: true, updatedAt: true },
        });
    return { view: toView(row), created: !existing };
  } catch (cause) {
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "P2002" &&
      !existing
    ) {
      // A concurrent first-submit by the same author won the unique race. Their row
      // was created moments ago, so the window is open — continue as an update.
      const winner = await prisma.sessionEvaluation.findFirst({
        where: { sessionId, authorUserId: author.userId },
        select: { id: true, createdAt: true },
      });
      if (winner && Date.now() < winner.createdAt.getTime() + EDIT_WINDOW_MS) {
        const row = await prisma.sessionEvaluation.update({
          where: { id: winner.id },
          data: { rating: input.rating, comment: input.comment },
          select: { id: true, rating: true, comment: true, authorType: true, authorUserId: true, createdAt: true, updatedAt: true },
        });
        return { view: toView(row), created: false };
      }
      throw new EvaluationError("CONFLICT", "The evaluation could not be saved.");
    }
    throw cause;
  }
}

/**
 * ADMIN/SUPERVISOR read for the session-detail page: every evaluation of the
 * session with the author type and student display name. NEVER reachable by a
 * teacher — callers gate on role before importing this (server-side).
 */
export async function getEvaluationsForSession(sessionId: string) {
  if (!(await isEvaluationsReady())) return [];
  return prisma.sessionEvaluation.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      rating: true,
      comment: true,
      authorType: true,
      createdAt: true,
      updatedAt: true,
      student: { select: { user: { select: { displayName: true } } } },
    },
  });
}
