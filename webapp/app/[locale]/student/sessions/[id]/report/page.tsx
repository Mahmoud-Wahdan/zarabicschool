import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import DashboardShell from "../../../../../_components/dashboard-shell";
import { requireRole } from "../../../../../../lib/dal";
import { prisma } from "../../../../../../lib/prisma";

export default async function StudentReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("STUDENT");
  const { id } = await params;
  const enrollment = await prisma.sessionStudent.findFirst({
    where: { sessionId: id, student: { userId: user.id } },
    select: {
      session: { select: { subject: { select: { nameEn: true, nameAr: true } }, scheduledStart: true } },
      studentId: true,
    },
  });
  if (!enrollment) notFound();
  const report = await prisma.report.findFirst({
    where: { sessionId: id, studentId: enrollment.studentId, status: "ARCHIVED" },
    select: { attendanceOutcome: true, classRemark: true, summary: true, homework: true, notes: true },
  });
  const t = await getTranslations("studentReport");
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("title")}</h1>
      <p className="mt-2 text-sm opacity-70">{enrollment.session.subject.nameEn}</p>
      {report ? (
        <article className="dashboard-card mt-6 space-y-3 p-5">
          <p><strong>{t("attendance")}:</strong> {report.attendanceOutcome}</p>
          <p><strong>{t("remark")}:</strong> {report.classRemark}</p>
          <p><strong>{t("summary")}:</strong> {report.summary}</p>
          {report.homework ? <p><strong>{t("homework")}:</strong> {report.homework}</p> : null}
          {report.notes ? <p><strong>{t("notes")}:</strong> {report.notes}</p> : null}
        </article>
      ) : (
        <p className="mt-6 rounded-xl border border-[var(--line)] bg-white p-5 text-sm opacity-70">{t("pending")}</p>
      )}
    </DashboardShell>
  );
}
