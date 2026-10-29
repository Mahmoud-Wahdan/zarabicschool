import { getLocale, getTranslations } from "next-intl/server";

import WeekCalendar from "../../../_components/calendar/week-calendar";
import DashboardShell from "../../../_components/dashboard-shell";
import { getCalendarSessions } from "../../../../lib/calendar/data";
import { buildWeek, parseWeekParam } from "../../../../lib/calendar/week";
import { requireRole } from "../../../../lib/dal";
import PageHeader from "../../../_components/ui/page-header";

export async function generateMetadata() {
  const t = await getTranslations("calendar");
  return { title: `${t("title")} | Zarabicschool` };
}

/** S-10 (D13, D27): the teacher's own sessions, one week at a time, view-only. */
export default async function TeacherCalendarPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requireRole("TEACHER");
  const locale = await getLocale();
  const t = await getTranslations("calendar");
  const timeZone = user.timezone || "Africa/Cairo";
  const weekStart = parseWeekParam((await searchParams).week, new Date(), timeZone);
  const { range } = buildWeek([], weekStart, timeZone);
  const sessions = await getCalendarSessions({ role: user.role, userId: user.id, academyId: user.academyId }, range);
  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <WeekCalendar sessions={sessions} weekStart={weekStart} timeZone={timeZone} locale={locale} role="TEACHER" basePath="/teacher/calendar" />
    </DashboardShell>
  );
}
