import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../dashboard-shell";
import EmptyState from "../ui/empty-state";
import Icon from "../ui/icon";
import MonthlyReportContent from "./monthly-report-content";
import { requireRoles } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { currentMonthKey, formatMonthLabel, isValidMonthKey, previousMonthKey } from "../../../lib/reports/month-key";
import { eligibleMonthlyStudents } from "../../../lib/reports/monthly";
import { isSession1ReportsReady } from "../../../lib/reports/session1-ready";
import { resolveReportLanguage, REPORT_LANGUAGE_OPTIONS } from "../../../lib/reports/report-language";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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

const MONTHLY_SELECT = {
  id: true,
  monthKey: true,
  achievement: true,
  learningProgress: true,
  classFocus: true,
  homeworkCompletion: true,
  punctuality: true,
  rescheduledSessions: true,
  supportAreas: true,
  nextMonthObjectives: true,
  language: true,
  submittedAt: true,
  teacherId: true,
  teacher: { select: { user: { select: { displayName: true } } } },
  student: { select: { user: { select: { displayName: true } } } },
} as const;

/**
 * Admin/Supervisor "all monthly reports" view (Session 1 — CONTEXT §9): every
 * monthly report for the selected month (filterable by teacher), plus the missing
 * list per teacher. READ-ONLY — the monthly stream has NO approval gate, no money,
 * no attendance, and no ledger, so a Supervisor sees exactly the same data.
 */
export default async function MonthlyReportsAdminPage({
  role,
  searchParams = {},
}: {
  role: "ADMIN" | "SUPERVISOR";
  searchParams?: SearchParams;
}) {
  const user = await requireRoles([role]);
  const locale = await getLocale();
  const t = await getTranslations("adminMonthly");
  const tShell = await getTranslations("appShell");
  const ready = await isSession1ReportsReady();

  const currentMonth = currentMonthKey(user.timezone || "Africa/Cairo");
  const rawMonth = first(searchParams.month);
  const monthKey = rawMonth && isValidMonthKey(rawMonth) && rawMonth <= currentMonth ? rawMonth : previousMonthKey(currentMonth);
  const rawTeacher = first(searchParams.teacher);
  const teacherFilter = rawTeacher && /^[0-9a-f-]{36}$/i.test(rawTeacher) ? rawTeacher : undefined;

  if (!ready) {
    return (
      <DashboardShell role={user.role} userName={user.displayName}>
        <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
        <EmptyState icon="hourglass_top" title={t("pendingTitle")} description={t("pendingText")} />
      </DashboardShell>
    );
  }

  const [reports, teachers] = await Promise.all([
    prisma.monthlyReport.findMany({
      where: {
        academyId: user.academyId,
        monthKey,
        ...(teacherFilter ? { teacherId: teacherFilter } : {}),
      },
      orderBy: [{ teacher: { user: { displayName: "asc" } } }, { student: { user: { displayName: "asc" } } }],
      select: MONTHLY_SELECT,
    }),
    prisma.teacher.findMany({
      where: { academyId: user.academyId, user: { isActive: true } },
      orderBy: { user: { displayName: "asc" } },
      select: { id: true, user: { select: { displayName: true } } },
    }),
  ]);

  // Missing list per teacher (same eligible-pair rule as the reminders): only
  // teachers who taught someone in the selected month — narrowed to the filtered
  // teacher when one is selected.
  const missingByTeacher = await Promise.all(
    teachers
      .filter((teacher) => !teacherFilter || teacher.id === teacherFilter)
      .map(async (teacher) => {
        const eligible = await eligibleMonthlyStudents(teacher.id, monthKey);
        if (!eligible.length) return null;
        const reported = new Set(
          (
            await prisma.monthlyReport.findMany({
              where: { teacherId: teacher.id, monthKey },
              select: { studentId: true },
            })
          ).map((row) => row.studentId),
        );
        const missing = eligible.filter((student) => !reported.has(student.studentId));
        return missing.length ? { teacher, missing } : null;
      }),
  );
  const missing = missingByTeacher.filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const languageDisplay = (code: string) =>
    REPORT_LANGUAGE_OPTIONS.find((option) => option.value === resolveReportLanguage(code))?.nativeName ?? code;

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
          <p className="mt-1 text-body-sm text-on-surface-variant">{t("subtitle")}</p>
        </div>
        <span className="rounded bg-secondary-fixed/30 px-2 py-1 text-label-sm font-semibold text-secondary">
          {role === "ADMIN" ? tShell("scope.ADMIN") : tShell("scope.SUPERVISOR")}
        </span>
      </div>

      <form className="z-card mt-4 flex flex-wrap items-end gap-3 rounded-xl p-4" action={role === "ADMIN" ? "/admin/monthly-reports" : "/supervisor/monthly-reports"}>
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
        <label className="flex flex-col gap-1 text-label-md font-semibold text-on-surface">
          {t("teacherLabel")}
          <select name="teacher" defaultValue={teacherFilter ?? ""} className="z-input">
            <option value="">{t("allTeachers")}</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.user.displayName}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-soft">
          {t("filter")}
        </button>
      </form>

      {missing.length > 0 ? (
        <section className="z-card mt-4 rounded-xl p-4">
          <h2 className="text-title-md font-bold text-primary">{t("missingTitle")}</h2>
          <p className="text-body-sm text-on-surface-variant">{t("missingHint")}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {missing.map(({ teacher, missing: students }) => (
              <li key={teacher.id} className="rounded-lg bg-tertiary-fixed/20 border border-outline-variant px-3 py-2">
                <p className="text-body-md font-bold text-primary">{teacher.user.displayName}</p>
                <p className="text-body-sm text-on-surface">
                  {t("missingCount", { count: students.length })}: {students.map((student) => student.displayName).join(locale === "ar" ? "، " : ", ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6 flex flex-col gap-3">
        <h2 className="text-title-md font-bold text-primary">{t("listTitle")}</h2>
        {reports.length === 0 ? (
          <EmptyState icon="calendar_month" title={t("emptyTitle")} description={t("emptyText")} />
        ) : (
          <div className="flex flex-col gap-4">
            {reports.map((report) => (
              <article key={report.id} className="z-card flex flex-col gap-3 rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-container text-sm font-bold text-on-primary">
                      {report.student.user.displayName.trim().slice(0, 1).toUpperCase() || "?"}
                    </span>
                    <div>
                      <p className="text-title-md font-bold text-primary">{report.student.user.displayName}</p>
                      <p className="text-label-sm text-on-surface-variant">{report.teacher.user.displayName}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded bg-surface-container px-2 py-0.5 text-label-sm text-on-surface-variant">
                      {formatMonthLabel(report.monthKey, locale === "en" ? "en" : "ar")}
                    </span>
                    <span className="text-label-sm text-outline">
                      <Icon name="translate" size={14} className="inline align-middle" /> {languageDisplay(report.language)}
                    </span>
                  </div>
                </div>
                <MonthlyReportContent report={report} />
              </article>
            ))}
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
