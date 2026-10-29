import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import DashboardShell from "../../../../../_components/dashboard-shell";
import EvaluationCard from "../../../../../_components/evaluations/evaluation-card";
import AttachmentList from "../../../../../_components/reports/attachment-list";
import { requireRole, studentFinanceBlocked } from "../../../../../../lib/dal";
import { getOwnEvaluation, isEvaluationsReady } from "../../../../../../lib/evaluations/service";
import { prisma } from "../../../../../../lib/prisma";
import { getClassRemarkOptions } from "../../../../../../lib/reports/class-remarks";
import { classRemarkLabel, remarkDisplayLanguage, reportDir } from "../../../../../../lib/reports/report-language";
import { getReportForViewer } from "../../../../../../lib/reports/visibility";

export default async function StudentReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("STUDENT");
  const financeHidden = await studentFinanceBlocked(user.id);
  const { id } = await params;
  const locale = await getLocale();
  const t = await getTranslations("studentReport");

  const enrollment = await prisma.sessionStudent.findFirst({
    where: { sessionId: id, student: { userId: user.id } },
    select: {
      studentId: true,
      session: {
        select: {
          subject: { select: { nameEn: true, nameAr: true } },
          status: true,
          scheduledEnd: true,
        },
      },
    },
  });
  if (!enrollment) notFound();

  // Role-shaped read through the visibility data layer (CONTEXT §9): a student with a
  // guardian sees ONLY homework, notes and attachments; an adult student without a
  // guardian sees the whole report. Visible from SUBMISSION in every status (owner,
  // 2026-10-18) — approval gates pay only.
  const [view, classRemarkOptions] = await Promise.all([
    getReportForViewer(
      { userId: user.id, academyId: user.academyId, role: user.role },
      id,
      enrollment.studentId,
    ),
    getClassRemarkOptions(user.academyId),
  ]);

  // Session evaluation (Session 3, Slice B — owner decision 2026-10-24): the STUDENT
  // evaluates the session/teacher after it ends. The teacher never sees it; nothing
  // here is shown to or derived from the teacher's surfaces.
  const sessionEnded =
    enrollment.session.status !== "CANCELLED" &&
    enrollment.session.status !== "MISSED" &&
    new Date() >= enrollment.session.scheduledEnd;
  const evaluationsReady = sessionEnded && (await isEvaluationsReady());
  const ownEvaluation = evaluationsReady
    ? await getOwnEvaluation(id, { userId: user.id, role: "STUDENT" })
    : null;

  const attachmentList = view?.attachments ?? [];
  return (
    <DashboardShell role={user.role} userName={user.displayName} hideNavKeys={financeHidden ? ["invoices"] : undefined}>
      <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
      <p className="mt-2 text-body-sm text-on-surface-variant">
        {locale === "en" ? enrollment.session.subject.nameEn : enrollment.session.subject.nameAr}
      </p>
      {view ? (
        // The report CONTENT renders in the language it was written (CONTEXT §9),
        // with its own dir — the surrounding chrome stays in the UI locale.
        <article
          className="z-card rounded-xl mt-6 space-y-3 p-5"
          dir={view.language ? reportDir(view.language) : undefined}
          lang={view.language ?? undefined}
        >
          {view.classRemark ? (
            <p>
              <strong>{t("remark")}:</strong>{" "}
              {classRemarkLabel(classRemarkOptions, view.classRemark, remarkDisplayLanguage(view.language, locale))}
            </p>
          ) : null}
          {view.summary ? (
            <p><strong>{t("summary")}:</strong> {view.summary}</p>
          ) : null}
          {view.homework ? <p><strong>{t("homework")}:</strong> {view.homework}</p> : null}
          {view.notes ? <p><strong>{t("notes")}:</strong> {view.notes}</p> : null}
          {attachmentList.length > 0 ? (
            <div>
              <p className="font-semibold">{t("attachments")}</p>
              <AttachmentList reportId={view.id} items={attachmentList} />
            </div>
          ) : null}
        </article>
      ) : (
        <p className="mt-6 rounded-xl border border-outline-variant bg-surface-container-lowest p-5 text-body-sm text-on-surface-variant">{t("pending")}</p>
      )}
      {evaluationsReady ? (
        <div className="mt-6">
          <EvaluationCard
            sessionId={id}
            initialRating={ownEvaluation?.rating ?? null}
            initialComment={ownEvaluation?.comment ?? null}
            locked={ownEvaluation?.locked ?? false}
          />
        </div>
      ) : null}
    </DashboardShell>
  );
}
