import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import Icon from "../../../_components/ui/icon";
import StatusBadge from "../../../_components/ui/status-badge";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("attendance");
  return { title: `${t("guardian")} | Zarabicschool` };
}

/**
 * Guardian attendance view (Batch D): one section per child with their past sessions,
 * attendance written from approved reports, and the report status incl. MISSING.
 */
export default async function GuardianAttendancePage() {
  const user = await requireRole("GUARDIAN");
  const locale = await getLocale();
  const t = await getTranslations("attendance");
  const now = new Date();
  const [children, sessions] = await Promise.all([
    prisma.student.findMany({
      where: { academyId: user.academyId, guardian: { userId: user.id } },
      orderBy: { createdAt: "asc" },
      select: { id: true, user: { select: { displayName: true } } },
    }),
    prisma.session.findMany({
      where: { academyId: user.academyId, students: { some: { student: { guardian: { userId: user.id } } } }, scheduledEnd: { lt: now } },
      orderBy: { scheduledStart: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        scheduledStart: true,
        subject: { select: { nameAr: true, nameEn: true } },
        students: { select: { studentId: true, attendanceStatus: true } },
        reports: { select: { studentId: true, status: true } },
      },
    }),
  ]);
  const subjectName = (subject: { nameEn: string; nameAr: string }) => (locale === "ar" ? subject.nameAr : subject.nameEn);

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-8 text-white sm:px-10">
        <Icon name="family_restroom" size={32} className="text-[var(--gold)]" />
        <h1 className="mt-3 text-3xl font-bold">{t("guardian.title")}</h1>
        <p className="mt-2 text-sm text-white/80">{t("guardian.subtitle")}</p>
      </section>
      {children.map((child) => {
        const childSessions = sessions
          .map((session) => ({ session, roster: session.students.find((entry) => entry.studentId === child.id) }))
          .filter((entry): entry is { session: (typeof sessions)[number]; roster: NonNullable<(typeof sessions)[number]["students"][number]> } =>
            Boolean(entry.roster));
        return (
          <section key={child.id} className="mt-6 space-y-3">
            <h2 className="text-lg font-bold text-[var(--navy)]">{child.user.displayName}</h2>
            {childSessions.map(({ session, roster }) => {
              const report = session.reports.find((entry) => entry.studentId === child.id);
              return (
                <article key={`${child.id}:${session.id}`} className="dashboard-card flex flex-wrap items-center justify-between gap-3 p-5">
                  <div>
                    <strong className="text-[var(--navy)]">{subjectName(session.subject)}</strong>
                    <p className="mt-1 text-sm opacity-70">
                      {formatSessionDateTime(session.scheduledStart, user.timezone, locale)} · {t(`sessionStatuses.${session.status}`)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      tone={roster.attendanceStatus === "ATTENDED" ? "success" : roster.attendanceStatus === "STUDENT_ABSENT" ? "danger" : "pending"}
                    >
                      {t(`attendanceStatuses.${roster.attendanceStatus}`)}
                    </StatusBadge>
                    <span className="rounded bg-surface-container px-2 py-0.5 text-label-sm text-on-surface-variant">
                      {t(`reportStatuses.${report?.status ?? "MISSING"}`)}
                    </span>
                  </div>
                </article>
              );
            })}
            {!childSessions.length ? (
              <p className="dashboard-card p-5 text-sm opacity-70">{t("guardian.empty", { name: child.user.displayName })}</p>
            ) : null}
          </section>
        );
      })}
      {!children.length ? <p className="dashboard-card mt-6 p-5 text-sm opacity-70">{t("guardian.noChildren")}</p> : null}
    </DashboardShell>
  );
}
