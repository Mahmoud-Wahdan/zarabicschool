import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import ActivitySummary from "../../_components/dashboard/activity-summary";
import EmptyState from "../../_components/ui/empty-state";
import { getReportForViewer } from "../../../lib/reports/visibility";
import PageHeader from "../../_components/ui/page-header";
import { requireRole } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { formatSessionDateTime } from "../../../lib/schedules/display";
import { Link } from "../../../i18n/navigation";

import AnnouncementsWidget from "../../_components/announcements/announcements-widget";
import EvaluationPromptCard from "../../_components/evaluations/evaluation-prompt-card";
export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: `${t("guardian.title")} | Zarabicschool` };
}

export default async function GuardianDashboard({ searchParams }: { searchParams: Promise<{ child?: string; activity?: string }> }) {
  const user = await requireRole("GUARDIAN");
  const [t, tShell, locale] = await Promise.all([getTranslations("dashboard"), getTranslations("appShell"), getLocale()]);
  const params = await searchParams;
  const now = new Date();
  const scope = { academyId: user.academyId, guardian: { userId: user.id } };
  const [children, calendar, activity] = await Promise.all([
    prisma.student.findMany({ where: scope, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, user: { select: { displayName: true } } } }),
    getTranslations("calendar"), getTranslations("activity"),
  ]);
  const child = children.find(row => row.id === params.child) ?? children[0];
  const upcoming = { session: { academyId: user.academyId, status: "SCHEDULED" as const, scheduledStart: { gte: now } } };
  const student = child && await prisma.student.findFirst({
    where: { ...scope, id: child.id },
    select: {
      subscriptions: { where: { status: "ACTIVE" }, select: { ledgerEntries: { select: { sessionsDelta: true } } } },
      _count: { select: { sessionStudents: { where: upcoming } } },
      sessionStudents: { where: upcoming, orderBy: { session: { scheduledStart: "asc" } }, take: 3,
        select: { session: { select: { id: true, scheduledStart: true, subject: { select: { nameAr: true, nameEn: true } } } } } },
      reports: { orderBy: { submittedAt: "desc" }, take: 1, select: { sessionId: true } },
    },
  });
  const latest = student?.reports[0];
  const feedback = latest && await getReportForViewer({ userId: user.id, role: user.role, academyId: user.academyId }, latest.sessionId, child.id);

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <PageHeader title={t("guardian.title")} subtitle={t("guardian.welcome", { name: user.displayName })} />

      {children.length > 1 && <nav aria-label={calendar("childTabs")} className="flex flex-wrap gap-2">
        {children.map(row => <Link key={row.id} href={{ pathname: "/guardian", query: { child: row.id, activity: params.activity } }}
          className={row.id === child.id ? "btn btn-primary" : "btn btn-outline"} aria-current={row.id === child.id ? "page" : undefined}>
          {row.user.displayName}
        </Link>)}
      </nav>}
      {student ? <>
        <section className="activity-panel">
          <h2 className="text-headline-sm font-semibold text-primary">{child.user.displayName} · {t("guardian.sections.schedule")}</h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {student._count.sessionStudents} {t("guardian.metrics.upcoming")}
          </p>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {student.subscriptions.reduce(
              (sum, item) => sum + item.ledgerEntries.reduce((total, entry) => total + entry.sessionsDelta, 0),
              0,
            )} {t("guardian.metrics.remaining")}
          </p>
          {student.sessionStudents.length ? (
            <ul className="mt-2 space-y-1 text-label-sm text-on-surface-variant">
              {student.sessionStudents.map((item) => (
                <li key={item.session.id}>
                  {locale === "ar" ? item.session.subject.nameAr : item.session.subject.nameEn}
                  {" · "}
                  {formatSessionDateTime(item.session.scheduledStart, user.timezone, locale)}
                </li>
              ))}
            </ul>
          ) : null}
          <Link href={{ pathname: "/guardian/calendar", query: { child: child.id } }} className="btn btn-outline mt-4">{t("guardian.actions.schedule")}</Link>
        </section>
        <ActivitySummary user={user} now={now} query={params} childId={child.id} />
      </> : <EmptyState icon="person_off" title={calendar("noChildren")} />}
      <AnnouncementsWidget academyId={user.academyId} timeZone={user.timezone || "Africa/Cairo"} />
      <EvaluationPromptCard userId={user.id} academyId={user.academyId} role="GUARDIAN" />
      <section className="mt-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
        <h2 className="font-semibold text-primary">{activity("feedback")}</h2>
        {feedback ? <p lang={feedback.language} dir="auto" className="mt-2 line-clamp-4 whitespace-pre-line text-body-md">{feedback.summary}</p>
          : <p className="mt-2 text-body-sm text-on-surface-variant">{activity("noFeedback")}</p>}
        <Link href="/guardian/reports" className="btn btn-primary mt-3 inline-block rounded-lg px-3 py-2 text-xs">
          {t("guardian.actions.reports")}
        </Link>
      </section>
      <section className="mt-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
        <h2 className="font-semibold text-primary">{t("guardian.sections.finance")}</h2>
        <p className="mt-2 text-body-sm text-on-surface-variant">{t("guardian.metrics.remainingFromSubscriptions")}</p>
        <Link href="/guardian/invoices" className="btn btn-primary mt-3 inline-block rounded-lg px-3 py-2 text-xs">
          {tShell("nav.invoices")}
        </Link>
      </section>
    </DashboardShell>
  );
}
