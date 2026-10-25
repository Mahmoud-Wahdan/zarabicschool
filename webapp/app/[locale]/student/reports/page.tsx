import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import EvaluateSessionDetails from "../../../_components/evaluations/evaluate-session-details";
import AttachmentList from "../../../_components/reports/attachment-list";
import Icon from "../../../_components/ui/icon";
import { requireRole, studentFinanceBlocked } from "../../../../lib/dal";
import { getOwnEvaluationsForSessions, isEvaluationsReady } from "../../../../lib/evaluations/service";
import { prisma } from "../../../../lib/prisma";
import { getClassRemarkOptions, classRemarkLabel } from "../../../../lib/reports/class-remarks";
import { remarkDisplayLanguage, reportDir } from "../../../../lib/reports/report-language";
import { getReportForViewer } from "../../../../lib/reports/visibility";
import { formatSessionDateTime } from "../../../../lib/schedules/display";
import { Link } from "../../../../i18n/navigation";

export async function generateMetadata() {
  const t = await getTranslations("studentReports");
  return { title: `${t("title")} | Zarabicschool` };
}

/**
 * The student's own session reports (owner finding, 2026-10-25). Every report is
 * read through the visibility data layer as the STUDENT: a student WITH a guardian
 * receives only homework/notes/attachments; an adult without a guardian the whole
 * report (CONTEXT §9). Ended sessions offer the student's own evaluation, which the
 * teacher never sees (Session 3, Slice B).
 */
export default async function StudentReportsPage() {
  const user = await requireRole("STUDENT");
  const financeHidden = await studentFinanceBlocked(user.id);
  const locale = await getLocale();
  const [t, tReport] = await Promise.all([getTranslations("studentReports"), getTranslations("studentReport")]);
  const now = new Date();

  const roster = await prisma.sessionStudent.findMany({
    where: { student: { userId: user.id }, session: { academyId: user.academyId, scheduledEnd: { lte: now } } },
    orderBy: { session: { scheduledStart: "desc" } },
    take: 30,
    select: {
      studentId: true,
      session: {
        select: {
          id: true,
          status: true,
          scheduledStart: true,
          subject: { select: { nameAr: true, nameEn: true } },
          teacher: { select: { user: { select: { displayName: true } } } },
        },
      },
    },
  });
  const viewer = { userId: user.id, academyId: user.academyId, role: "STUDENT" as const };
  const [entries, classRemarkOptions, evaluations, evaluationsReady] = await Promise.all([
    Promise.all(
      roster.map(async (entry) => ({
        session: entry.session,
        view: await getReportForViewer(viewer, entry.session.id, entry.studentId),
      })),
    ),
    getClassRemarkOptions(user.academyId),
    getOwnEvaluationsForSessions(
      roster.map((entry) => entry.session.id),
      { userId: user.id, role: "STUDENT" },
    ),
    isEvaluationsReady(),
  ]);
  const reports = entries.filter(
    (entry): entry is { session: (typeof entries)[number]["session"]; view: NonNullable<(typeof entries)[number]["view"]> } =>
      Boolean(entry.view),
  );
  const subjectName = (subject: { nameAr: string; nameEn: string }) => (locale === "en" ? subject.nameEn : subject.nameAr);

  return (
    <DashboardShell role={user.role} userName={user.displayName} hideNavKeys={financeHidden ? ["invoices"] : undefined}>
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-8 text-white sm:px-10">
        <Icon name="description" size={32} className="text-[var(--gold)]" />
        <h1 className="mt-3 text-3xl font-bold">{t("title")}</h1>
        <p className="mt-2 text-sm text-white/80">{t("subtitle")}</p>
      </section>
      <div className="mt-6 space-y-3">
        {reports.map(({ session, view }) => {
          const language = remarkDisplayLanguage(view.language, locale);
          return (
            <article key={view.id} className="dashboard-card space-y-2 p-5">
              <div className="flex flex-wrap justify-between gap-2">
                <strong className="text-[var(--navy)]">{subjectName(session.subject)}</strong>
                <span className="text-sm opacity-70">{formatSessionDateTime(session.scheduledStart, user.timezone, locale)}</span>
              </div>
              <p className="text-sm opacity-70">{session.teacher.user.displayName}</p>
              {/* Report content renders in the language it was written (CONTEXT §9). */}
              <div className="space-y-2" dir={view.language ? reportDir(view.language) : undefined} lang={view.language ?? undefined}>
                {view.classRemark ? (
                  <p className="text-sm">
                    <strong>{tReport("remark")}:</strong> {classRemarkLabel(classRemarkOptions, view.classRemark, language)}
                  </p>
                ) : null}
                {view.summary ? <p className="text-sm"><strong>{tReport("summary")}:</strong> {view.summary}</p> : null}
                {view.homework ? <p className="text-sm"><strong>{tReport("homework")}:</strong> {view.homework}</p> : null}
                {view.notes ? <p className="text-sm"><strong>{tReport("notes")}:</strong> {view.notes}</p> : null}
              </div>
              {view.attachments.length > 0 ? (
                <div>
                  <p className="text-sm font-semibold">{tReport("attachments")}</p>
                  <AttachmentList reportId={view.id} items={view.attachments} />
                </div>
              ) : null}
              <Link href={`/student/sessions/${session.id}/report`} className="text-xs text-[var(--emerald)] underline-offset-2 hover:underline">
                {t("open")}
              </Link>
              {evaluationsReady && session.status !== "CANCELLED" && session.status !== "MISSED" ? (
                <EvaluateSessionDetails
                  sessionId={session.id}
                  label={t("evaluate")}
                  evaluation={evaluations.get(session.id) ?? null}
                />
              ) : null}
            </article>
          );
        })}
        {!reports.length ? <p className="dashboard-card p-5 text-sm opacity-70">{t("empty")}</p> : null}
      </div>
    </DashboardShell>
  );
}
