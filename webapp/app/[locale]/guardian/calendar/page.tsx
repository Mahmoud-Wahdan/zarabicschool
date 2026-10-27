import { getLocale, getTranslations } from "next-intl/server";

import WeekCalendar from "../../../_components/calendar/week-calendar";
import DashboardShell from "../../../_components/dashboard-shell";
import EmptyState from "../../../_components/ui/empty-state";
import { Link } from "../../../../i18n/navigation";
import { getCalendarSessions } from "../../../../lib/calendar/data";
import { buildWeek, parseWeekParam } from "../../../../lib/calendar/week";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";

export async function generateMetadata() {
  const t = await getTranslations("calendar");
  return { title: `${t("title")} | Zarabicschool` };
}

/**
 * S-10 (D13, D27): the guardian's calendar — one tab per linked child, the child's
 * name on top, that child's sessions only, view-only. An unknown `?child=` falls back
 * to the first linked child (never another family's child).
 */
export default async function GuardianCalendarPage({ searchParams }: { searchParams: Promise<{ week?: string; child?: string }> }) {
  const user = await requireRole("GUARDIAN");
  const locale = await getLocale();
  const t = await getTranslations("calendar");
  const timeZone = user.timezone || "Africa/Cairo";
  const query = await searchParams;
  const children = await prisma.student.findMany({
    where: { academyId: user.academyId, guardian: { userId: user.id } },
    orderBy: { createdAt: "asc" },
    select: { id: true, user: { select: { displayName: true } } },
  });
  const child = children.find((row) => row.id === query.child) ?? children[0] ?? null;
  const weekStart = parseWeekParam(query.week, new Date(), timeZone);
  const { range } = buildWeek([], weekStart, timeZone);
  const sessions = child
    ? await getCalendarSessions({ role: user.role, userId: user.id, academyId: user.academyId }, range, child.id)
    : [];
  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">{t("guardianSubtitle")}</p>
      {!child ? (
        <EmptyState icon="person_off" title={t("noChildren")} />
      ) : (
        <>
          {children.length > 1 ? (
            <nav className="mt-4 flex flex-wrap gap-2" aria-label={t("childTabs")}>
              {children.map((row) => (
                <Link
                  key={row.id}
                  href={{ pathname: "/guardian/calendar", query: { child: row.id, week: weekStart } }}
                  aria-current={row.id === child.id ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 text-label-md ${row.id === child.id ? "bg-primary text-on-primary" : "border border-outline-variant"}`}
                >
                  {row.user.displayName}
                </Link>
              ))}
            </nav>
          ) : null}
          <h2 className="mt-4 text-title-md font-bold text-primary">{child.user.displayName}</h2>
          <WeekCalendar
            sessions={sessions}
            weekStart={weekStart}
            timeZone={timeZone}
            locale={locale}
            role="GUARDIAN"
            basePath="/guardian/calendar"
            extraQuery={{ child: child.id }}
          />
        </>
      )}
    </DashboardShell>
  );
}
