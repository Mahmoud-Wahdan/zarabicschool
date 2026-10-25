import { getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
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
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("enrollments.title")}</h1>
      <p className="mt-2 text-sm opacity-70">{t("enrollments.subtitle")}</p>
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
