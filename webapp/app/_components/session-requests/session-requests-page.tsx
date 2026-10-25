import { getLocale, getTranslations } from "next-intl/server";

import { prisma } from "../../../lib/prisma";
import { requireRoles } from "../../../lib/dal";
import { isSessionRequestsReady } from "../../../lib/scheduling/session-requests";
import DashboardShell from "../dashboard-shell";
import PageHeader from "../ui/page-header";
import SessionRequestsPanel, { type QueueSessionRequest } from "./session-requests-panel";

export default async function SessionRequestsPage({ role }: { role: "ADMIN" | "SUPERVISOR" }) {
  const user = await requireRoles([role]);
  const locale = await getLocale();
  const t = await getTranslations("sessionRequests");
  const tShell = await getTranslations("appShell");

  const ready = await isSessionRequestsReady();
  let requests: QueueSessionRequest[] = [];
  if (ready) {
    const rows = await prisma.sessionRequest.findMany({
      where: { academyId: user.academyId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        status: true,
        reason: true,
        createdAt: true,
        reviewedAt: true,
        replacementSessionId: true,
        requestedBy: { select: { id: true, role: true, displayName: true } },
        session: {
          select: {
            id: true,
            status: true,
            sessionType: true,
            scheduledStart: true,
            scheduledEnd: true,
            timezone: true,
            teacherId: true,
            subjectId: true,
            subject: { select: { nameAr: true, nameEn: true } },
            teacher: { select: { user: { select: { displayName: true } } } },
            students: {
              select: {
                studentId: true,
                student: { select: { userId: true, guardianId: true, user: { select: { displayName: true } } } },
              },
            },
          },
        },
      },
    });
    requests = rows.map((row) => {
      const requesterStudentId =
        row.requestedBy.role === "STUDENT"
          ? row.session.students.find((entry) => entry.student.userId === row.requestedBy.id)?.studentId ?? null
          : null;
      return {
        id: row.id,
        status: row.status,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        replacementSessionId: row.replacementSessionId,
        requesterName: row.requestedBy.displayName,
        requesterRole: row.requestedBy.role,
        requesterStudentId,
        sessionId: row.session.id,
        sessionStatus: row.session.status,
        sessionType: row.session.sessionType,
        subjectName: locale === "en" ? row.session.subject.nameEn : row.session.subject.nameAr,
        teacherName: row.session.teacher.user.displayName,
        scheduledStart: row.session.scheduledStart.toISOString(),
        scheduledEnd: row.session.scheduledEnd.toISOString(),
        timezone: row.session.timezone,
        teacherId: row.session.teacherId,
        subjectId: row.session.subjectId,
        students: row.session.students.map((entry) => ({
          id: entry.studentId,
          name: entry.student.user.displayName,
          isRequester: entry.student.userId === row.requestedBy.id,
        })),
      };
    });
  }

  const pendingCount = requests.filter((request) => request.status === "PENDING").length;

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone} navBadges={{ requests: pendingCount }}>
      <PageHeader
        eyebrow={role === "ADMIN" ? tShell("scope.ADMIN") : tShell("scope.SUPERVISOR")}
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <SessionRequestsPanel
        requests={requests}
        pendingCount={pendingCount}
        migrationPending={!ready}
        locale={locale}
      />
    </DashboardShell>
  );
}
