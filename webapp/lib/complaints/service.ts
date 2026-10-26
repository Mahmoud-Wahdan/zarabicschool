import "server-only";

import type { ComplaintCategory, ComplaintPartyRole, ComplaintStatus } from "../../generated/prisma/client";

import { prisma } from "../prisma";

/**
 * Complaints (Phase 7, owner 2026-10-26).
 *
 * VISIBILITY RULE (server-side, the only read paths): a complaint is readable ONLY
 * by ADMIN and SUPERVISOR of the same academy. There is NO read path for any other
 * role — not for the concerned party, not for the filer (the filer gets a
 * confirmation on submit only) — so lists, counts, notifications, search and direct
 * URLs cannot leak it. Nothing is ever sent to the concerned party: Admin/Supervisor
 * inform them manually.
 */

export const COMPLAINT_CATEGORIES: ComplaintCategory[] = ["TEACHING_QUALITY", "BEHAVIOUR", "PUNCTUALITY", "TECHNICAL", "BILLING", "OTHER"];

export type ComplaintParty = { userId: string; role: ComplaintPartyRole; displayName: string };

type Filer = { id: string; academyId: string; role: string };

/**
 * The parties of ONE session the filer may complain about — the session's teacher,
 * its roster students, and those students' guardians — or null when the filer is
 * not a participant of that session (teacher of it, a roster student, or the
 * guardian of a roster student). The filer is never offered as a party.
 */
export async function getComplaintParties(filer: Filer, sessionId: string): Promise<ComplaintParty[] | null> {
  if (filer.role !== "TEACHER" && filer.role !== "STUDENT" && filer.role !== "GUARDIAN") return null;
  // Only sessions that have started (a complaint is about something that happened;
  // a cancelled session stays allowed — e.g. a late cancellation).
  const session = await prisma.session.findFirst({
    where: { id: sessionId, academyId: filer.academyId, scheduledStart: { lte: new Date() } },
    select: {
      teacher: { select: { user: { select: { id: true, displayName: true } } } },
      students: {
        select: {
          student: {
            select: {
              user: { select: { id: true, displayName: true } },
              guardian: { select: { user: { select: { id: true, displayName: true } } } },
            },
          },
        },
      },
    },
  });
  if (!session) return null;
  const parties: ComplaintParty[] = [{ userId: session.teacher.user.id, role: "TEACHER", displayName: session.teacher.user.displayName }];
  const seen = new Set<string>([session.teacher.user.id]);
  for (const { student } of session.students) {
    if (!seen.has(student.user.id)) {
      seen.add(student.user.id);
      parties.push({ userId: student.user.id, role: "STUDENT", displayName: student.user.displayName });
    }
    const guardianUser = student.guardian?.user;
    if (guardianUser && !seen.has(guardianUser.id)) {
      seen.add(guardianUser.id);
      parties.push({ userId: guardianUser.id, role: "GUARDIAN", displayName: guardianUser.displayName });
    }
  }
  const filerIsParticipant = parties.some((party) => party.userId === filer.id && party.role === filer.role);
  if (!filerIsParticipant) return null;
  // Minors' data: a student or guardian does not otherwise see other families'
  // names, so they may only name the session's TEACHER. A teacher (assigned to
  // these students) may name any roster student or guardian. Complaints between
  // families are OPEN for the owner.
  if (filer.role !== "TEACHER") return parties.filter((party) => party.role === "TEACHER");
  return parties.filter((party) => party.userId !== filer.id);
}

/** Sessions the filer took part in (newest first) — the complaint form's choices. */
export async function getComplaintSessions(filer: Filer, take = 30) {
  const where =
    filer.role === "TEACHER"
      ? { teacher: { userId: filer.id } }
      : filer.role === "STUDENT"
        ? { students: { some: { student: { userId: filer.id } } } }
        : { students: { some: { student: { guardian: { userId: filer.id } } } } };
  return prisma.session.findMany({
    where: { academyId: filer.academyId, scheduledStart: { lte: new Date() }, ...where },
    orderBy: { scheduledStart: "desc" },
    take,
    select: { id: true, scheduledStart: true, subject: { select: { nameAr: true, nameEn: true } } },
  });
}

/** Forward-only workflow: NEW → IN_PROGRESS → RESOLVED (owner, 2026-10-26). */
export function nextComplaintStatus(current: ComplaintStatus): ComplaintStatus | null {
  if (current === "NEW") return "IN_PROGRESS";
  if (current === "IN_PROGRESS") return "RESOLVED";
  return null;
}

export function isComplaintOperator(role: string) {
  return role === "ADMIN" || role === "SUPERVISOR";
}
