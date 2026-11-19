import { shiftMonth } from "../../../lib/calendar/month";
import LearningReview from "./learning-review";
import { monthRangeUtc } from "../../../lib/performance/teacher-indicators";
import { formatMoney } from "../../../lib/payments/format";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "../../../i18n/navigation";
import { getActivity, getReturningLearners } from "../../../lib/dashboard/activity";
import { formatMonthLabel, currentMonthKey, previousMonthKey, isValidMonthKey } from "../../../lib/reports/month-key";
import type { AuthUser } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";

type Props = { user: AuthUser; now: Date; query: Record<string, string | undefined>; childId?: string };

export default async function ActivitySummary(props: Props) {
  const t = await getTranslations("common");
  return <Suspense fallback={<p className="activity-panel" role="status">{t("loading")}</p>}>
    <Activity {...props} />
  </Suspense>;
}

async function Activity({ user, now, query, childId }: Props) {
  const zone = user.timezone || "Africa/Cairo";
  const current = currentMonthKey(zone, now);
  const options = Array.from({ length: 12 }, (_, index) => shiftMonth(current, -index));
  const month = query.activity && isValidMonthKey(query.activity) && options.includes(query.activity) ? query.activity : current;
  const previous = previousMonthKey(month);
  const staff = user.role === "ADMIN" || user.role === "SUPERVISOR";
  const payVisible = user.role === "ADMIN" || user.role === "TEACHER";
  const range = monthRangeUtc(month, zone);
  const [t, locale, selected, prior, accounts, assigned, credits, cohort] = await Promise.all([
    getTranslations("activity"), getLocale(), getActivity(user, month, now, childId), getActivity(user, previous, now, childId),
    staff ? prisma.user.groupBy({ by: ["role"], where: { academyId: user.academyId, isActive: true,
      role: { in: user.role === "ADMIN" ? ["STUDENT", "TEACHER", "GUARDIAN"] : ["STUDENT", "TEACHER"] } }, _count: true }) : [],
    user.role === "TEACHER" ? prisma.student.count({ where: { academyId: user.academyId, assignments: { some: { status: "ACTIVE", teacher: { userId: user.id } } } } }) : null,
    payVisible ? prisma.payrollLedger.groupBy({
      by: ["currency"], where: { academyId: user.academyId, entryType: "SESSION_CREDIT",
        createdAt: { gte: range.start, lt: range.end },
        ...(user.role === "TEACHER" && { teacher: { userId: user.id } }) },
      _sum: { amountMinor: true }, orderBy: { currency: "asc" },
    }) : [],
    getReturningLearners(user, month),
  ]);
  if (!selected || !prior) return null;
  const label = (value: string) => formatMonthLabel(value, locale === "ar" ? "ar" : "en");
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const rate = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const metrics: (keyof typeof selected)[] = staff ? ["total", "completed", "missed", "completion", "attendance", "missing", "submission"]
    : user.role === "TEACHER" ? ["total", "completed", "hours", "attendance"] : ["total", "completed", "attendance"];
  function format(key: (typeof metrics)[number], value: number | null) {
    return value === null ? t("unavailable") : (key === "completion" || key === "attendance" || key === "submission" ? rate : number).format(value);
  }
  return <section className="activity-panel" aria-labelledby="activity-title">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 id="activity-title" className="text-headline-sm font-semibold text-primary">{t("title")}</h2>
        <p className="text-body-sm text-on-surface-variant">{t("period", { zone })}</p></div>
      <form className="flex flex-wrap items-center gap-2" method="get">
        {Object.entries(query).filter(([key, value]) => ["child", "view", "week", "month", "revenue"].includes(key) && typeof value === "string").map(([key,value]) => <input key={key} type="hidden" name={key} value={value} />)}
        <label className="sr-only" htmlFor="activity-month">{t("month")}</label>
        <select className="z-select" style={{ width: "auto" }} id="activity-month" name="activity" defaultValue={month}>{options.map(value => <option key={value} value={value}>{label(value)}</option>)}</select>
        <button className="btn btn-outline">{t("apply")}</button>
      </form>
    </div>
    <table className="activity-table">
      <caption className="sr-only">{t("title")}</caption>
      <thead><tr><th scope="col">{t("metric")}</th><th scope="col">{label(month)}</th><th scope="col">{label(previous)}</th></tr></thead>
      <tbody>{metrics.map(key => <tr key={key}><th scope="row">{t(key)}</th><td>{format(key, selected[key])}</td><td>{format(key, prior[key])}</td></tr>)}</tbody>
    </table>
    <p className="text-body-sm text-on-surface-variant">{t("definition")}</p>
    {staff && <p className="text-body-sm text-on-surface-variant">{t("submissionDefinition")}</p>}
    {assigned !== null && <p className="mt-3 text-body-sm">{t("assigned", { count: number.format(assigned) })} · <Link href="/teacher/indicators" className="text-secondary underline">{t("teachingDetails")}</Link></p>}
    {staff && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-outline-variant pt-3 text-body-sm">
      {(user.role === "ADMIN" ? ["STUDENT","TEACHER","GUARDIAN"] as const : ["STUDENT","TEACHER"] as const).map(role =>
        <span key={role}>{t(role)} <strong>{number.format(accounts.find(row => row.role === role)?._count ?? 0)}</strong></span>)}
      <Link className="text-secondary underline" href="/admin/analytics">{t("details")}</Link>
    </div>}
    {cohort && <p className="mt-2 text-body-sm text-on-surface-variant">
      {cohort.prior ? t("returning", { prior: number.format(cohort.prior), count: number.format(cohort.returning),
        previous: label(previous), month: label(month) }) : t("noCohort", { month: label(previous) })}
    </p>}
    {payVisible && <div className="mt-3 border-t border-outline-variant pt-3 text-body-sm">
      <Link href={user.role === "ADMIN" ? "/admin/payroll" : "/teacher/payroll"} className="text-secondary underline">{t("credits")} · {label(month)}</Link>
      {credits.length ? <ul>{credits.map(row => <li key={row.currency}><bdi>{formatMoney(row._sum.amountMinor ?? 0, row.currency, locale)}</bdi></li>)}</ul>
        : <p className="text-on-surface-variant">{t("noCredits")}</p>}
    </div>}
    <LearningReview user={user} studentId={childId} month={month} />
  </section>;
}
