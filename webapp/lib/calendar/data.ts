import "server-only";

import { prisma } from "../prisma";

/**
 * Calendar read model (S-10, D13): the viewer's OWN sessions in a UTC range, with
 * only what an entry shows — time, status, type, subject, teacher, roster names.
 * Never a Zoom link (joining stays on the sessions pages, inside the join window).
 * A student or guardian sees only their own/the child's roster entry (no other
 * students' names); a guardian must name a child linked to them.
 */
export type CalendarViewer = { role: string; userId: string; academyId: string };

export async function getCalendarSessions(viewer: CalendarViewer, range: { start: Date; end: Date }, childId?: string) {
  const scope =
    viewer.role === "TEACHER"
      ? { teacher: { userId: viewer.userId } }
      : viewer.role === "STUDENT"
        ? { students: { some: { student: { userId: viewer.userId } } } }
        : viewer.role === "GUARDIAN" && childId
          ? { students: { some: { studentId: childId, student: { guardian: { userId: viewer.userId } } } } }
          : null;
  if (!scope) return [];
  const rosterFilter =
    viewer.role === "STUDENT"
      ? { student: { userId: viewer.userId } }
      : viewer.role === "GUARDIAN"
        ? { studentId: childId }
        : undefined;
  return prisma.session.findMany({
    where: { academyId: viewer.academyId, scheduledStart: { gte: range.start, lt: range.end }, ...scope },
    orderBy: { scheduledStart: "asc" },
    take: 200,
    select: {
      id: true,
      scheduledStart: true,
      scheduledEnd: true,
      status: true,
      sessionType: true,
      subject: { select: { nameEn: true, nameAr: true } },
      teacher: { select: { user: { select: { displayName: true } } } },
      students: {
        ...(rosterFilter ? { where: rosterFilter } : {}),
        select: { studentId: true, student: { select: { user: { select: { displayName: true } } } } },
      },
    },
  });
}

export type CalendarSession = Awaited<ReturnType<typeof getCalendarSessions>>[number];
