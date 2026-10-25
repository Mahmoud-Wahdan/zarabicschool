import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import EmptyState from "../../../_components/ui/empty-state";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { creditAmountMinor } from "../../../../lib/payroll/rates";
import { formatMoney } from "../../../../lib/payments/format";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("payroll");
  return { title: `${t("teacherTitle")} | Zarabicschool` };
}

/**
 * Teacher payroll (own data only): approved earnings per currency from the
 * append-only PayrollLedger, the pending-approval estimate (submitted reports ×
 * the effective rate), and the ledger history. Supervisor/Admin amounts never
 * appear here to anyone else, and the teacher never sees other teachers' rows.
 */
export default async function TeacherPayrollPage() {
  const user = await requireRole("TEACHER");
  const [t, locale] = await Promise.all([getTranslations("payroll"), getLocale()]);
  const teacher = await prisma.teacher.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const [entries, pendingReports, currentRate] = teacher
    ? await Promise.all([
        prisma.payrollLedger.findMany({
          where: { academyId: user.academyId, teacherId: teacher.id },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            entryType: true,
            amountMinor: true,
            currency: true,
            minutesCredited: true,
            hourlyRateSnapshotMinor: true,
            reason: true,
            createdById: true,
            createdAt: true,
            session: { select: { id: true, scheduledStart: true, subject: { select: { nameAr: true, nameEn: true } } } },
          },
        }),
        prisma.report.findMany({
          where: { academyId: user.academyId, teacherId: teacher.id, status: "SUBMITTED", attendanceOutcome: "ATTENDED", extraTimeStatus: { not: "PENDING" } },
          select: { sessionId: true, session: { select: { durationMinutes: true, scheduledStart: true, subject: { select: { nameAr: true, nameEn: true } } } } },
          take: 50,
        }),
        prisma.teacherRate.findFirst({
          where: { teacherId: teacher.id, effectiveFrom: { lte: new Date() } },
          orderBy: { effectiveFrom: "desc" },
          select: { hourlyRateMinor: true, currency: true },
        }),
      ])
    : [[], [], null];

  const balanceByCurrency = new Map<string, number>();
  for (const entry of entries) {
    balanceByCurrency.set(entry.currency, (balanceByCurrency.get(entry.currency) ?? 0) + entry.amountMinor);
  }
  const pendingByCurrency = new Map<string, number>();
  if (currentRate) {
    for (const report of pendingReports) {
      const amount = creditAmountMinor(report.session.durationMinutes, currentRate.hourlyRateMinor);
      pendingByCurrency.set(currentRate.currency, (pendingByCurrency.get(currentRate.currency) ?? 0) + amount);
    }
  }

  const subjectName = (subject: { nameAr: string; nameEn: string }) => (locale === "ar" ? subject.nameAr : subject.nameEn);

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("teacherTitle")}</h1>
      <p className="mt-2 text-sm opacity-70">{t("teacherSubtitle")}</p>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...balanceByCurrency.entries()].map(([currency, total]) => (
          <div key={currency} className="rounded-xl border border-[var(--line)] bg-white p-5">
            <h2 className="text-sm font-semibold text-[var(--navy)]">{t("balanceLabel")} ({currency})</h2>
            <p className="mt-2 text-2xl font-bold">{formatMoney(total, currency, locale)}</p>
            {pendingByCurrency.get(currency) ? (
              <p className="mt-1 text-xs opacity-70">
                {t("pendingLabel")}: {formatMoney(pendingByCurrency.get(currency) ?? 0, currency, locale)}
              </p>
            ) : null}
          </div>
        ))}
        {balanceByCurrency.size === 0 ? (
          <div className="rounded-xl border border-[var(--line)] bg-white p-5 sm:col-span-2 lg:col-span-3">
            <EmptyState icon="payments" title={t("balanceLabel")} description={t("emptyLedger")} />
          </div>
        ) : null}
      </section>

      <section className="mt-6 rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold text-[var(--navy)]">{t("ledgerTitle")}</h2>
        {entries.length === 0 ? (
          <p className="mt-3 text-sm opacity-70">{t("emptyLedger")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-start text-sm">
              <thead className="border-b border-[var(--line)] text-xs opacity-70">
                <tr>
                  <th className="px-3 py-2 text-start">{t("colDate")}</th>
                  <th className="px-3 py-2 text-start">{t("colType")}</th>
                  <th className="px-3 py-2 text-start">{t("colAmount")}</th>
                  <th className="px-3 py-2 text-start">{t("colSession")}</th>
                  <th className="px-3 py-2 text-start">{t("colMinutes")}</th>
                  <th className="px-3 py-2 text-start">{t("colReason")}</th>
                  <th className="px-3 py-2 text-start">{t("colCreated")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-3 py-3 opacity-70">
                      {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(entry.createdAt)}
                    </td>
                    <td className="px-3 py-3">{t(`entryType.${entry.entryType}`)}</td>
                    <td className="px-3 py-3 font-semibold">{formatMoney(entry.amountMinor, entry.currency, locale)}</td>
                    <td className="px-3 py-3">
                      {entry.session
                        ? `${subjectName(entry.session.subject)} · ${formatSessionDateTime(entry.session.scheduledStart, user.timezone, locale)}`
                        : "—"}
                    </td>
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
