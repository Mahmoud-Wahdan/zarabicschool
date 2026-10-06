import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import { requireRole } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";

export const metadata = { title: "لوحة المعلمة | Zarabicschool" };

export default async function TeacherDashboard() {
  const user = await requireRole("TEACHER");
  const t = await getTranslations("dashboard");
  const teacher = await prisma.teacher.findUnique({
    where: { userId: user.id },
    select: {
      subjects: { select: { subject: { select: { nameAr: true, nameEn: true } } } },
      sessions: {
        where: { scheduledStart: { gte: new Date() } },
        orderBy: { scheduledStart: "asc" },
        take: 8,
        select: {
          scheduledStart: true,
          scheduledEnd: true,
          sessionType: true,
          status: true,
          subject: { select: { nameAr: true, nameEn: true } },
          students: { select: { student: { select: { user: { select: { displayName: true } } } } } },
        },
      },
    },
  });
  const currentLocale = await getLocale();
  const formatDate = (value: Date) => new Intl.DateTimeFormat(currentLocale === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("teacher.title")}</h1>
      <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
        {t("teacher.welcome", { name: user.displayName })}
      </p>

      <section className="mt-6 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("teacher.sections.today")}</h2>
        <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
          {teacher?.sessions.length ?? 0} {t("teacher.metrics.upcoming")}
        </p>
        <div className="mt-4 space-y-3">
          {teacher?.sessions.map((session) => (
            <div key={`${session.scheduledStart.toISOString()}-${session.subject.nameEn}`} className="rounded-lg bg-[var(--background)] p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{currentLocale === "ar" ? session.subject.nameAr : session.subject.nameEn}</strong>
                <span>{formatDate(session.scheduledStart)}</span>
              </div>
              <p className="mt-1 opacity-70">
                {session.students.length} {t("teacher.metrics.students")} · {session.sessionType}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("teacher.sections.reports")}</h2>
        <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
          {teacher?.subjects.length ?? 0} {t("teacher.metrics.subjects")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {teacher?.subjects.map(({ subject }) => (
            <span key={subject.nameEn} className="rounded-full bg-[var(--background)] px-3 py-1 text-sm">
              {currentLocale === "ar" ? subject.nameAr : subject.nameEn}
            </span>
          ))}
        </div>
      </section>
      <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("teacher.sections.salary")}</h2>
        <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">{t("teacher.metrics.salaryUnavailable")}</p>
      </section>
    </DashboardShell>
  );
}
