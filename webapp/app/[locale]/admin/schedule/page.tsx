import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import BoardFilters from "../../../_components/schedule-board/board-filters";
import BoardGrid from "../../../_components/schedule-board/board-grid";
import ThresholdSetting from "../../../_components/schedule-board/threshold-setting";
import EmptyState from "../../../_components/ui/empty-state";
import PageHeader from "../../../_components/ui/page-header";
import { getScheduleBoard } from "../../../../lib/calendar/board";
import { DEFAULT_BOARD_STATUSES } from "../../../../lib/config/schedule-board";
import { requireRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { zonedYmd } from "../../../../lib/schedules/recurrence";
import { scheduleBoardQuerySchema } from "../../../../lib/validation/schedule-board";

export async function generateMetadata() {
  const t = await getTranslations("scheduleBoard");
  return { title: `${t("title")} | Zarabicschool` };
}

/**
 * S-16 (Part C, D91): the teacher schedule board — Admin and Supervisor. Day view (one
 * row per teacher) or week view (one teacher); teacher / student / status filters that
 * apply on select; totals in scheduled minutes; viewer zone; no Zoom links, no money.
 */
export default async function ScheduleBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const locale = await getLocale();
  const t = await getTranslations("scheduleBoard");
  const timeZone = user.timezone || "Africa/Cairo";
  const today = zonedYmd(new Date(), timeZone);
  const raw = await searchParams;
  const parsed = scheduleBoardQuerySchema.safeParse(raw);
  const filters = parsed.success ? parsed.data : { view: "day" as const, status: DEFAULT_BOARD_STATUSES };
  const date = filters.date ?? today;
  const weekWithoutTeacher = filters.view === "week" && !filters.teacherId;

  const [teachers, students, board] = await Promise.all([
    prisma.teacher.findMany({
      where: { academyId: user.academyId, approvalStatus: "APPROVED", user: { isActive: true } },
      orderBy: { user: { displayName: "asc" } },
      take: 300,
      select: { id: true, user: { select: { displayName: true } } },
    }),
    prisma.student.findMany({
      where: { academyId: user.academyId, user: { isActive: true } },
      orderBy: { user: { displayName: "asc" } },
      take: 1000,
      select: { id: true, user: { select: { displayName: true } } },
    }),
    getScheduleBoard({
      academyId: user.academyId,
      timeZone,
      date,
      view: weekWithoutTeacher ? "day" : filters.view,
      teacherId: filters.teacherId,
      studentId: filters.studentId,
      statuses: filters.status,
    }),
  ]);

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle", { zone: timeZone })} />
      <div className="mt-4 space-y-4">
        <BoardFilters
          date={date}
          today={today}
          previous={board.previous}
          next={board.next}
          view={filters.view}
          teacherId={filters.teacherId}
          studentId={filters.studentId}
          statuses={filters.status}
          teachers={teachers.map((teacher) => ({ id: teacher.id, name: teacher.user.displayName }))}
          students={students.map((student) => ({ id: student.id, name: student.user.displayName }))}
        />
        {user.role === "ADMIN" ? <ThresholdSetting initialHours={board.thresholdMinutes / 60} /> : null}
        {weekWithoutTeacher ? <p role="status" className="text-body-sm text-on-surface-variant">{t("weekNeedsTeacher")}</p> : null}
        {board.truncated ? <p role="status" className="text-body-sm text-on-surface-variant">{t("truncated")}</p> : null}
        <p className="text-label-sm text-on-surface-variant">{t("legend", { hours: board.thresholdMinutes / 60 })}</p>
        {board.rows.length === 0 ? (
          <EmptyState icon="date_range" title={t("empty")} />
        ) : (
          <BoardGrid rows={board.rows} timeZone={timeZone} locale={locale} view={board.view} thresholdMinutes={board.thresholdMinutes} />
        )}
      </div>
    </DashboardShell>
  );
}
