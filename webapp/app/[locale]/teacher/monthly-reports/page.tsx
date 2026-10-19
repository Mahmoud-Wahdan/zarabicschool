import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "../../../../i18n/navigation";

import DashboardShell from "../../../_components/dashboard-shell";
import EmptyState from "../../../_components/ui/empty-state";
import Icon from "../../../_components/ui/icon";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { currentMonthKey, formatMonthLabel, isValidMonthKey, previousMonthKey } from "../../../../lib/reports/month-key";
import { eligibleMonthlyStudents } from "../../../../lib/reports/monthly";
import { isSession1ReportsReady } from "../../../../lib/reports/session1-ready";

export async function generateMetadata() {
  const t = await getTranslations("teacherMonthly");
  return { title: `${t("title")} | Zarabicschool` };
}

function monthOptions(anchor: string): string[] {
  const options: string[] = [];
  let key = anchor;
  for (let i = 0; i < 12; i += 1) {
    options.push(key);
    key = previousMonthKey(key);
  }
  return options;
}

/**
 * Teacher monthly reports (Session 1 — CONTEXT §9, PROPOSAL until confirmed):
 * list of the eligible (teacher, student) pairs for the selected month — students
 * with at least one session with this teacher in that month — with each report's
 * state (submitted / missing). No money, no attendance, no approval gate.
 */
export default async function TeacherMonthlyReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireRole("TEACHER");
  const locale = await getLocale();
  const t = await getTranslations("teacherMonthly");
  const { month } = await searchParams;
  const ready = await isSession1ReportsReady();

  const currentMonth = currentMonthKey(user.timezone || "Africa/Cairo");
  const monthKey = month && isValidMonthKey(month) && month <= currentMonth ? month : previousMonthKey(currentMonth);

  if (!ready) {
    return (
      <DashboardShell role={user.role} userName={user.displayName}>
        <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
        <EmptyState icon="hourglass_top" title={t("pendingTitle")} description={t("pendingText")} />
      </DashboardShell>
    );
  }

  const teacher = await prisma.teacher.findUniqueOrThrow({
    where: { userId: user.id },
    select: { id: true, academyId: true },
  });

  const [eligible, submitted] = await Promise.all([
    eligibleMonthlyStudents(teacher.id, monthKey),
    prisma.monthlyReport.findMany({
      where: { teacherId: teacher.id, monthKey },
      select: { studentId: true, submittedAt: true },
    }),
  ]);
  const submittedByStudent = new Map(submitted.map((row) => [row.studentId, row.submittedAt]));
  const missing = eligible.filter((student) => !submittedByStudent.has(student.studentId));

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">{t("subtitle")}</p>

      <form className="z-card mt-4 flex flex-wrap items-end gap-3 rounded-xl p-4" action={`/teacher/monthly-reports`}>
        <label className="flex flex-col gap-1 text-label-md font-semibold text-on-surface">
          {t("monthLabel")}
          <select name="month" defaultValue={monthKey} className="z-input">
            {monthOptions(currentMonth).map((option) => (
              <option key={option} value={option}>
                {formatMonthLabel(option, locale === "en" ? "en" : "ar")}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-soft">
          {t("filterMonth")}
        </button>
      </form>

      {missing.length > 0 ? (
        <section className="z-card mt-4 rounded-xl p-4">
          <h2 className="text-title-md font-bold text-primary">{t("missingTitle", { count: missing.length })}</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {missing.map((student) => (
              <li key={student.studentId} className="flex items-center justify-between rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2">
                <span className="text-body-md text-on-surface">{student.displayName}</span>
                <Link href={`/teacher/monthly-reports/${student.studentId}?month=${monthKey}`} className="btn btn-primary px-3 py-1 text-xs">
                  {t("writeReport")}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6 flex flex-col gap-2">
        <h2 className="text-title-md font-bold text-primary">{t("listTitle")}</h2>
        {eligible.length === 0 ? (
          <EmptyState icon="event_busy" title={t("emptyTitle")} description={t("emptyText")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {eligible.map((student) => {
              const submittedAt = submittedByStudent.get(student.studentId);
              return (
                <li key={student.studentId} className="z-card flex flex-wrap items-center justify-between gap-2 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-container text-sm font-bold text-on-primary">
                      {student.displayName.trim().slice(0, 1).toUpperCase() || "?"}
                    </span>
                    <div>
                      <p className="text-title-md font-bold text-primary">{student.displayName}</p>
                      {submittedAt ? (
                        <p className="text-label-sm text-on-surface-variant">
                          {t("submittedOn", {
                            time: new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(submittedAt),
                          })}
                        </p>
                      ) : (
                        <p className="text-label-sm font-semibold text-on-error-container">{t("missingChip")}</p>
                      )}
                    </div>
                  </div>
                  <Link href={`/teacher/monthly-reports/${student.studentId}?month=${monthKey}`} className="btn btn-soft px-3 py-1.5 text-xs">
                    <Icon name="edit_note" size={16} />
                    {submittedAt ? t("viewEdit") : t("writeReport")}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </DashboardShell>
  );
}
