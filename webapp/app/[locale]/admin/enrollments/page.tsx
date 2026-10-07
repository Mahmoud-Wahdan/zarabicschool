import DashboardShell from "../../../_components/dashboard-shell";
import { requireRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import EnrollmentsPanel from "./enrollments-panel";

export default async function EnrollmentsPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const [sessions, students] = await Promise.all([
    prisma.session.findMany({
      where: { academyId: user.academyId },
      orderBy: { scheduledStart: "desc" },
      take: 50,
      select: {
        id: true,
        scheduledStart: true,
        sessionType: true,
        subject: { select: { nameEn: true, nameAr: true } },
        teacher: { select: { user: { select: { displayName: true } } } },
        students: { select: { studentId: true } },
      },
    }),
    prisma.student.findMany({
      where: { academyId: user.academyId, user: { isActive: true } },
      orderBy: { user: { displayName: "asc" } },
      select: { id: true, user: { select: { displayName: true } } },
    }),
  ]);

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">Session enrollments</h1>
      <p className="mt-2 text-sm opacity-70">Manage which students are enrolled in each session.</p>
      <EnrollmentsPanel
        sessions={sessions.map((session) => ({
          ...session,
          scheduledStart: session.scheduledStart.toISOString(),
        }))}
        students={students}
      />
    </DashboardShell>
  );
}
