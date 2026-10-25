import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import AdminPayrollPanel from "../../../_components/payroll/admin-payroll-panel";
import EmptyState from "../../../_components/ui/empty-state";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { formatMoney } from "../../../../lib/payments/format";

export async function generateMetadata() {
  const t = await getTranslations("payroll");
  return { title: `${t("adminTitle")} | Zarabicschool` };
}

/**
 * Admin payroll management: per-teacher balances by currency (PayrollLedger sums),
 * rate/adjustment/payout forms, and the financial consistency checks — approved
 * attended reports without their ledger rows, and ledger rows without a settled
 * report. Supervisor never reaches this page (server-side ADMIN gate).
 */
export default async function AdminPayrollPage() {
  const user = await requireRole("ADMIN");
  const [t, locale] = await Promise.all([getTranslations("payroll"), getLocale()]);

  const teachers = await prisma.teacher.findMany({
    where: { academyId: user.academyId },
    orderBy: { user: { displayName: "asc" } },
    select: { id: true, user: { select: { displayName: true } } },
  });
  const teacherNames = new Map(teachers.map((teacher) => [teacher.id, teacher.user.displayName]));

  const [balances, ledger, rates] = await Promise.all([
    prisma.payrollLedger.groupBy({
      by: ["teacherId", "currency"],
      where: { academyId: user.academyId },
      _sum: { amountMinor: true },
    }),
    prisma.payrollLedger.findMany({
      where: { academyId: user.academyId },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: {
        id: true,
        teacherId: true,
        entryType: true,
        amountMinor: true,
        currency: true,
        minutesCredited: true,
        reason: true,
        createdById: true,
        createdAt: true,
      },
    }),
    prisma.teacherRate.findMany({
      where: { academyId: user.academyId },
      orderBy: { effectiveFrom: "desc" },
      select: { id: true, teacherId: true, hourlyRateMinor: true, currency: true, effectiveFrom: true },
    }),
  ]);
  const latestRateByTeacher = new Map<string, { hourlyRateMinor: number; currency: string; effectiveFrom: Date }>();
  for (const rate of rates) {
    if (!latestRateByTeacher.has(rate.teacherId)) {
      latestRateByTeacher.set(rate.teacherId, { hourlyRateMinor: rate.hourlyRateMinor, currency: rate.currency, effectiveFrom: rate.effectiveFrom });
    }
  }

  // ---- consistency checks -------------------------------------------------
  const settledAttendedReports = await prisma.report.findMany({
    where: { academyId: user.academyId, status: { in: ["APPROVED", "ARCHIVED"] }, attendanceOutcome: "ATTENDED" },
    select: { id: true, sessionId: true, teacher: { select: { user: { select: { displayName: true } } } } },
    take: 500,
  });
  const sessionIds = [...new Set(settledAttendedReports.map((report) => report.sessionId))];
  const [credits, deductions] = await Promise.all([
    prisma.payrollLedger.findMany({
      where: { academyId: user.academyId, entryType: "SESSION_CREDIT", sessionId: { in: sessionIds } },
      select: { sessionId: true },
    }),
    prisma.subscriptionLedger.findMany({
      where: { academyId: user.academyId, entryType: "SESSION_DEDUCTION", reportId: { in: settledAttendedReports.map((report) => report.id) } },
      select: { reportId: true },
    }),
  ]);
  const creditedSessions = new Set(credits.map((credit) => credit.sessionId));
  const deductedReportIds = new Set(deductions.map((entry) => entry.reportId));
  const sessionsWithoutCredit = sessionIds.filter((sessionId) => !creditedSessions.has(sessionId));
  const reportsWithoutDeduction = settledAttendedReports.filter((report) => !deductedReportIds.has(report.id));
  const orphanCredits = await prisma.payrollLedger.findMany({
    where: { academyId: user.academyId, entryType: "SESSION_CREDIT", report: { settledAt: null } },
    select: { id: true, teacherId: true, amountMinor: true, currency: true },
    take: 50,
  });

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("adminTitle")}</h1>
      <p className="mt-2 text-sm opacity-70">{t("adminSubtitle")}</p>

      <section className="mt-6">
        <h2 className="font-semibold text-[var(--navy)]">{t("balancesTitle")}</h2>
        {balances.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon="payments" title={t("balancesTitle")} description={t("emptyLedger")} />
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {balances.map((balance) => (
              <div key={`${balance.teacherId}-${balance.currency}`} className="rounded-xl border border-[var(--line)] bg-white p-4">
                <p className="text-sm font-semibold">{teacherNames.get(balance.teacherId)}</p>
                <p className="mt-1 text-lg font-bold">{formatMoney(balance._sum.amountMinor ?? 0, balance.currency, locale)}</p>
                {latestRateByTeacher.get(balance.teacherId) ? (
                  <p className="mt-1 text-xs opacity-60">
                    {t("ratesTitle")}: {latestRateByTeacher.get(balance.teacherId)!.hourlyRateMinor}/{locale === "ar" ? "ساعة" : "h"} ({latestRateByTeacher.get(balance.teacherId)!.currency})
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-red-700">{t("ratesTitle")}: —</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-6">
        <AdminPayrollPanel teachers={teachers.map((teacher) => ({ id: teacher.id, displayName: teacher.user.displayName }))} />
      </div>

      <section className="mt-6 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("consistencyTitle")}</h2>
        {sessionsWithoutCredit.length === 0 && reportsWithoutDeduction.length === 0 && orphanCredits.length === 0 ? (
          <p className="mt-3 text-sm opacity-70">{t("consistencyOk")}</p>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            {sessionsWithoutCredit.length > 0 ? (
              <div>
                <p className="font-semibold">{t("consistencyMissingCredit")}</p>
                <ul className="mt-1 list-inside list-disc text-xs opacity-75">
                  {sessionsWithoutCredit.slice(0, 10).map((sessionId) => (
                    <li key={sessionId}>{sessionId}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {reportsWithoutDeduction.length > 0 ? (
              <div>
                <p className="font-semibold">{t("consistencyMissingDeduction")}</p>
                <ul className="mt-1 list-inside list-disc text-xs opacity-75">
                  {reportsWithoutDeduction.slice(0, 10).map((report) => (
                    <li key={report.id}>
                      {report.teacher.user.displayName} · {report.id}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {orphanCredits.length > 0 ? (
              <div>
                <p className="font-semibold">{t("consistencyOrphanCredit")}</p>
                <ul className="mt-1 list-inside list-disc text-xs opacity-75">
                  {orphanCredits.map((credit) => (
                    <li key={credit.id}>
                      {teacherNames.get(credit.teacherId)} · {formatMoney(credit.amountMinor, credit.currency, locale)} · {credit.id}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("ledgerTitle")}</h2>
        {ledger.length === 0 ? (
          <p className="mt-3 text-sm opacity-70">{t("emptyLedger")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-start text-sm">
              <thead className="border-b border-[var(--line)] text-xs opacity-70">
                <tr>
                  <th className="px-3 py-2 text-start">{t("colDate")}</th>
                  <th className="px-3 py-2 text-start">{t("teacherLabel")}</th>
                  <th className="px-3 py-2 text-start">{t("colType")}</th>
                  <th className="px-3 py-2 text-start">{t("colAmount")}</th>
                  <th className="px-3 py-2 text-start">{t("colMinutes")}</th>
                  <th className="px-3 py-2 text-start">{t("colReason")}</th>
                  <th className="px-3 py-2 text-start">{t("colCreated")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-3 py-3 opacity-70">
                      {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(entry.createdAt)}
                    </td>
                    <td className="px-3 py-3">{teacherNames.get(entry.teacherId)}</td>
                    <td className="px-3 py-3">{t(`entryType.${entry.entryType}`)}</td>
                    <td className="px-3 py-3 font-semibold">{formatMoney(entry.amountMinor, entry.currency, locale)}</td>
                    <td className="px-3 py-3">{entry.minutesCredited ?? "—"}</td>
                    <td className="px-3 py-3 opacity-70">{entry.reason ?? "—"}</td>
                    <td className="px-3 py-3 opacity-70">{entry.createdById ? t("adminTitle") : t("system")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
