import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import DashboardShell from "../../../../../_components/dashboard-shell";
import { requireRole } from "../../../../../../lib/dal";
import { prisma } from "../../../../../../lib/prisma";
import { getReportForViewer } from "../../../../../../lib/reports/visibility";

export default async function StudentReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("STUDENT");
  const { id } = await params;
  const locale = await getLocale();
  const t = await getTranslations("studentReport");

  const enrollment = await prisma.sessionStudent.findFirst({
    where: { sessionId: id, student: { userId: user.id } },
    select: { studentId: true, session: { select: { subject: { select: { nameEn: true, nameAr: true } } } } },
  });
  if (!enrollment) notFound();

  // Role-shaped read through the visibility data layer (CONTEXT §9): a student with a
  // guardian sees ONLY homework, notes and attachments; an adult student without a
  // guardian sees the whole report. Gate: APPROVED/ARCHIVED (owner decision 2026-10-14).
  const view = await getReportForViewer(
    { userId: user.id, academyId: user.academyId, role: user.role },
    id,
    enrollment.studentId,
  );

  const attachmentList = view?.attachments ?? [];
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
      <p className="mt-2 text-body-sm text-on-surface-variant">
        {locale === "en" ? enrollment.session.subject.nameEn : enrollment.session.subject.nameAr}
      </p>
      {view ? (
        <article className="dashboard-card mt-6 space-y-3 p-5">
          {view.classRemark ? (
            <p><strong>{t("remark")}:</strong> {view.classRemark}</p>
          ) : null}
          {view.summary ? (
            <p><strong>{t("summary")}:</strong> {view.summary}</p>
          ) : null}
          {view.homework ? <p><strong>{t("homework")}:</strong> {view.homework}</p> : null}
          {view.notes ? <p><strong>{t("notes")}:</strong> {view.notes}</p> : null}
          {attachmentList.length > 0 ? (
            <div>
              <p className="font-semibold">{t("attachments")}</p>
              <ul className="mt-1 space-y-1">
                {attachmentList.map((attachment) => (
                  <li key={attachment.id} className="text-sm">
                    {attachment.originalName}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>
      ) : (
        <p className="mt-6 rounded-xl border border-[var(--line)] bg-white p-5 text-sm opacity-70">{t("pending")}</p>
      )}
    </DashboardShell>
  );
}
