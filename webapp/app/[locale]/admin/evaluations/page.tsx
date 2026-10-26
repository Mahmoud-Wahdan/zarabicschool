import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import EmptyState from "../../../_components/ui/empty-state";
import { requireRoles } from "../../../../lib/dal";
import { isEvaluationsReady } from "../../../../lib/evaluations/service";
import { prisma } from "../../../../lib/prisma";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("evaluationSummaries");
  return { title: `${t("title")} | Zarabicschool` };
}

const RECENT_COMMENTS_PER_TEACHER = 5;

/**
 * Evaluation summaries (Phase 7, owner 2026-10-26): per teacher — average rating,
 * number of evaluations, recent comments. ADMIN and SUPERVISOR only; the teacher
 * never sees it; nothing is triggered automatically from it. Authors appear as a
 * type (student/guardian) only. Performance ANALYSIS is Phase 9.
 */
export default async function EvaluationSummariesPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const [t, locale] = await Promise.all([getTranslations("evaluationSummaries"), getLocale()]);

  if (!(await isEvaluationsReady())) {
    return (
      <DashboardShell role={user.role} userName={user.displayName}>
        <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
        <EmptyState icon="hourglass_top" title={t("pendingTitle")} />
      </DashboardShell>
    );
  }

  const aggregates = (await prisma.$queryRaw`
    SELECT s.teacher_id AS "teacherId", ROUND(AVG(e.rating)::numeric, 2)::float AS average, COUNT(*)::int AS count
    FROM session_evaluations e
    JOIN sessions s ON s.id = e.session_id
    WHERE e.academy_id = ${user.academyId}::uuid
    GROUP BY s.teacher_id`) as { teacherId: string; average: number; count: number }[];

  const [teachers, comments] = await Promise.all([
    prisma.teacher.findMany({
      where: { academyId: user.academyId },
      orderBy: { user: { displayName: "asc" } },
      select: { id: true, user: { select: { displayName: true, isActive: true } } },
    }),
    prisma.sessionEvaluation.findMany({
      where: { academyId: user.academyId, comment: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { id: true, comment: true, rating: true, authorType: true, createdAt: true, session: { select: { teacherId: true } } },
    }),
  ]);
  const byTeacher = new Map(aggregates.map((row) => [row.teacherId, row]));
  const commentsByTeacher = new Map<string, typeof comments>();
  for (const comment of comments) {
    const list = commentsByTeacher.get(comment.session.teacherId) ?? [];
    if (list.length < RECENT_COMMENTS_PER_TEACHER) list.push(comment);
    commentsByTeacher.set(comment.session.teacherId, list);
  }
  const rows = teachers.filter((teacher) => byTeacher.has(teacher.id) || teacher.user.isActive);

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">{t("subtitle")}</p>
      <section className="mt-4 flex flex-col gap-3">
        {rows.length === 0 ? (
          <EmptyState icon="reviews" title={t("emptyTitle")} />
        ) : (
          rows.map((teacher) => {
            const aggregate = byTeacher.get(teacher.id);
            const recent = commentsByTeacher.get(teacher.id) ?? [];
            return (
              <article key={teacher.id} className="z-card rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-title-md text-primary">{teacher.user.displayName}</strong>
                  <span className="text-body-sm">
                    {aggregate ? t("averageLine", { average: aggregate.average.toFixed(2), count: aggregate.count }) : t("noEvaluations")}
                  </span>
                </div>
                {recent.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-2">
                    {recent.map((comment) => (
                      <li key={comment.id} className="rounded-lg bg-surface-container-lowest p-2 text-body-sm">
                        <p className="whitespace-pre-wrap">{comment.comment}</p>
                        <p className="mt-1 text-label-sm text-outline">
                          {t(`author.${comment.authorType}`)} · {t("rating", { rating: comment.rating })} ·{" "}
                          {formatSessionDateTime(comment.createdAt, user.timezone, locale)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            );
          })
        )}
      </section>
    </DashboardShell>
  );
}
