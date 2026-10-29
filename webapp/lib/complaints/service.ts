import "server-only";

import type { ComplaintCategory, ComplaintPartyRole, ComplaintStatus, Prisma } from "../../generated/prisma/client";

import { isPhase7FollowupReady } from "../phase7/readiness";
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

/**
 * The choices offered to one filer for one session: named parties, plus — for a
 * student or guardian only — whether "another participant in this session" may be
 * chosen (no name is ever shown for it; Admin/Supervisor identify the person from
 * the roster). Owner, 2026-10-26.
 */
export type ComplaintPartyOptions = { parties: ComplaintParty[]; otherParticipant: boolean };

/** Form/API value of the unnamed "another participant in this session" choice. */
export const OTHER_PARTICIPANT = "OTHER_PARTICIPANT";

type Filer = { id: string; academyId: string; role: string };

/**
 * The parties of ONE session the filer may complain about — the session's teacher,
 * its roster students, and those students' guardians — or null when the filer is
 * not a participant of that session (teacher of it, a roster student, or the
 * guardian of a roster student). The filer is never offered as a party.
 */
export async function getComplaintParties(filer: Filer, sessionId: string): Promise<ComplaintPartyOptions | null> {
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
  // A teacher (assigned to these students) may name any roster student or guardian.
  if (filer.role === "TEACHER") return { parties: parties.filter((party) => party.userId !== filer.id), otherParticipant: false };
  // Minors' data (owner, 2026-10-26): a student or guardian never sees other
  // families' names, so they may NAME only the session's teacher, and may choose the
  // unnamed "another participant in this session" when the session has someone
  // outside their own family (another student or that student's guardian).
  // Own family = the filer's guardian (a guardian filer is that guardian) and every
  // roster student of that guardian — siblings are family, not "another participant".
  const familyGuardianId =
    filer.role === "GUARDIAN"
      ? filer.id
      : session.students.find(({ student }) => student.user.id === filer.id)?.student.guardian?.user.id ?? null;
  const ownFamily = new Set<string>([filer.id]);
  if (familyGuardianId) ownFamily.add(familyGuardianId);
  for (const { student } of session.students) {
    if (familyGuardianId && student.guardian?.user.id === familyGuardianId) ownFamily.add(student.user.id);
  }
  const hasOtherFamily = parties.some((party) => party.role !== "TEACHER" && !ownFamily.has(party.userId));
  return {
    parties: parties.filter((party) => party.role === "TEACHER"),
    otherParticipant: hasOtherFamily && (await isPhase7FollowupReady()),
  };
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

/**
 * S-07 / D41 (SQL S-9): the roster to show for a complaint about "another participant":
 * the students on the session when the complaint was filed (snapshot), or — for a
 * complaint filed before the snapshot existed — the session's current roster.
 */
export async function complaintRoster(academyId: string, complaint: { sessionId: string; rosterStudentIds: string[] }) {
  const where: Prisma.StudentWhereInput = complaint.rosterStudentIds.length
    ? { academyId, id: { in: complaint.rosterStudentIds } }
    : { academyId, sessionStudents: { some: { sessionId: complaint.sessionId } } };
  const students = await prisma.student.findMany({
    where,
    orderBy: { user: { displayName: "asc" } },
    select: { id: true, user: { select: { id: true, displayName: true } }, guardian: { select: { user: { select: { displayName: true } } } } },
  });
  return students.map((student) => ({ studentId: student.id, userId: student.user.id, name: student.user.displayName, guardianName: student.guardian?.user.displayName ?? null }));
}
