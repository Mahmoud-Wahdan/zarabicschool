import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import DashboardShell from "../../../../../_components/dashboard-shell";
import { requireRole } from "../../../../../../lib/dal";
import { prisma } from "../../../../../../lib/prisma";
import ReportForm from "./report-form";

export default async function TeacherReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ studentId?: string }>;
}) {
  const user = await requireRole("TEACHER");
  const { id } = await params;
  const { studentId } = await searchParams;
  if (!studentId) notFound();
  const sessionStudent = await prisma.sessionStudent.findFirst({
    where: { sessionId: id, studentId, session: { academyId: user.academyId, teacher: { userId: user.id } } },
    select: {
      student: { select: { user: { select: { displayName: true } } } },
      session: { select: { id: true, scheduledEnd: true, subject: { select: { nameAr: true, nameEn: true } } } },
    },
  });
  if (!sessionStudent) notFound();
  const t = await getTranslations("teacherReport");
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("title")}</h1>
      <p className="mt-2 text-sm opacity-70">
        {sessionStudent.student.user.displayName} · {sessionStudent.session.subject.nameEn}
      </p>
      <ReportForm sessionId={id} studentId={studentId} />
    </DashboardShell>
  );
}
