import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import PageHeader from "../../../_components/ui/page-header";
import { requireRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import EnrollmentsPanel from "./enrollments-panel";

export async function generateMetadata() {
  const t = await getTranslations("management");
  return { title: `${t("enrollments.title")} | Zarabicschool` };
}

export default async function EnrollmentsPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const t = await getTranslations("management");
  const [sessions, students] = await Promise.all([
    prisma.session.findMany({
      where: { academyId: user.academyId },
      orderBy: { scheduledStart: "desc" },
      take: 50,
      select: {
        id: true,
        scheduledStart: true,
        scheduledEnd: true,
        status: true,
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
      <PageHeader title={t("enrollments.title")} subtitle={t("enrollments.subtitle")} />
      <EnrollmentsPanel
        sessions={sessions.map((session) => ({
          ...session,
          scheduledStart: session.scheduledStart.toISOString(),
          scheduledEnd: session.scheduledEnd.toISOString(),
        }))}
        students={students}
        timeZone={user.timezone || "Africa/Cairo"}
        now={new Date().toISOString()}
      />
    </DashboardShell>
  );
}
