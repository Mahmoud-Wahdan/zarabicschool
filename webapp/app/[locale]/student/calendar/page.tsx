import { getLocale, getTranslations } from "next-intl/server";

import WeekCalendar from "../../../_components/calendar/week-calendar";
import DashboardShell from "../../../_components/dashboard-shell";
import { getCalendarSessions } from "../../../../lib/calendar/data";
import { buildWeek, parseWeekParam } from "../../../../lib/calendar/week";
import { requireRole } from "../../../../lib/dal";

export async function generateMetadata() {
  const t = await getTranslations("calendar");
  return { title: `${t("title")} | Zarabicschool` };
}

/** S-10 (D13, D27): the student's own sessions, one week at a time, view-only. */
export default async function StudentCalendarPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requireRole("STUDENT");
  const locale = await getLocale();
  const t = await getTranslations("calendar");
  const timeZone = user.timezone || "Africa/Cairo";
  const weekStart = parseWeekParam((await searchParams).week, new Date(), timeZone);
  const { range } = buildWeek([], weekStart, timeZone);
  const sessions = await getCalendarSessions({ role: user.role, userId: user.id, academyId: user.academyId }, range);
  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">{t("subtitle")}</p>
      <WeekCalendar sessions={sessions} weekStart={weekStart} timeZone={timeZone} locale={locale} role="STUDENT" basePath="/student/calendar" />
    </DashboardShell>
  );
}
