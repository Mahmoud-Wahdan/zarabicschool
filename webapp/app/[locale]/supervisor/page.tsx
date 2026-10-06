import { getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import { requireRole } from "../../../lib/dal";
import { prisma } from "../../../lib/prisma";
import { Link } from "../../../i18n/navigation";

type ApplicationStatus = "NEW" | "REVIEWED" | "APPROVED" | "REJECTED";
type ApplicationType = "GUARDIAN" | "STUDENT" | "TEACHER";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "supervisor" });
  return { title: `${t("title")} | Zarabicschool` };
}

export default async function SupervisorDashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const user = await requireRole("SUPERVISOR");
  const t = await getTranslations("supervisor");
  const { locale } = await params;

  const [statusCounts, profileCounts, recentApplications] = await Promise.all([
    prisma.application.groupBy({
      by: ["status"],
      where: { academyId: user.academyId },
      _count: { _all: true },
    }),
    Promise.all([
      prisma.student.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
      prisma.guardian.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
      prisma.teacher.count({ where: { academyId: user.academyId, user: { isActive: true } } }),
      prisma.subject.count({ where: { academyId: user.academyId, isActive: true } }),
    ]),
    prisma.application.findMany({
      where: { academyId: user.academyId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        applicationType: true,
        status: true,
        createdAt: true,
        details: true,
      },
    }),
  ]);

  const statusCountMap = new Map(
    statusCounts.map((row) => [row.status as ApplicationStatus, row._count._all]),
  );
  const [students, guardians, teachers, subjects] = profileCounts;
  const formatDate = (value: Date) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value);

  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <h1 className="text-xl font-bold text-[var(--navy)]">{t("title")}</h1>
      <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">
        {t("subtitle")}
      </p>
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ["pending", "NEW", "bg-[var(--gold)]/15"],
          ["reviewed", "REVIEWED", "bg-sky-100"],
          ["approved", "APPROVED", "bg-emerald-100"],
          ["rejected", "REJECTED", "bg-red-100"],
        ] as const).map(([key, status, color]) => (
          <div key={status} className={`rounded-xl border border-[var(--line)] p-4 ${color}`}>
            <p className="text-xs text-[var(--foreground)] opacity-70">{t(`metrics.${key}`)}</p>
            <p className="mt-2 text-2xl font-bold text-[var(--navy)]">
              {statusCountMap.get(status) ?? 0}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ["students", students],
          ["guardians", guardians],
          ["teachers", teachers],
          ["subjects", subjects],
        ] as const).map(([key, count]) => (
          <div key={key} className="rounded-xl border border-[var(--line)] bg-white p-4">
            <p className="text-xs text-[var(--foreground)] opacity-70">{t(`profiles.${key}`)}</p>
            <p className="mt-2 text-2xl font-bold text-[var(--navy)]">{count}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 rounded-xl border border-[var(--line)] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-[var(--navy)]">{t("recent.title")}</h2>
            <p className="mt-1 text-sm text-[var(--foreground)] opacity-60">{t("recent.description")}</p>
          </div>
          <Link
            href="/admin/applications"
            className="rounded-lg bg-[var(--navy)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            {t("recent.viewAll")}
          </Link>
        </div>

        {recentApplications.length === 0 ? (
          <p className="mt-5 rounded-lg bg-[var(--background)] p-4 text-sm text-[var(--foreground)] opacity-70">
            {t("recent.empty")}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-start text-sm">
              <thead className="border-b border-[var(--line)] text-xs text-[var(--foreground)] opacity-70">
                <tr>
                  <th className="px-3 py-2 text-start">{t("recent.name")}</th>
                  <th className="px-3 py-2 text-start">{t("recent.type")}</th>
                  <th className="px-3 py-2 text-start">{t("recent.status")}</th>
                  <th className="px-3 py-2 text-start">{t("recent.date")}</th>
                </tr>
              </thead>
              <tbody>
                {recentApplications.map((application) => {
                  const details = application.details as { full_name?: string } | null;
                  const type = application.applicationType as ApplicationType;
                  return (
                    <tr key={application.id} className="border-b border-[var(--line)] last:border-0">
                      <td className="px-3 py-3 font-medium text-[var(--navy)]">
                        {details?.full_name || t("recent.unnamed")}
                      </td>
                      <td className="px-3 py-3">{t(`types.${type}`)}</td>
                      <td className="px-3 py-3">{t(`statuses.${application.status}`)}</td>
                      <td className="px-3 py-3 text-xs opacity-70">{formatDate(application.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/admin/applications"
          className="rounded-xl border border-[var(--line)] bg-white p-5 transition hover:border-[var(--emerald)] hover:shadow-sm"
        >
          <h2 className="font-semibold text-[var(--navy)]">{t("applications.title")}</h2>
          <p className="mt-2 text-sm text-[var(--foreground)] opacity-60">{t("applications.description")}</p>
        </Link>
        <div className="rounded-xl border border-[var(--line)] bg-white p-5">
          <h2 className="font-semibold text-[var(--navy)]">{t("reports.title")}</h2>
          <p className="mt-2 text-sm text-[var(--foreground)] opacity-60">{t("reports.description")}</p>
        </div>
      </section>
      <p className="mt-4 text-xs text-[var(--foreground)] opacity-60">{t("restricted")}</p>
    </DashboardShell>
  );
}
