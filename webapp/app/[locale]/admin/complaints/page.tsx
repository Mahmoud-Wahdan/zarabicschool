import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../../_components/dashboard-shell";
import EmptyState from "../../../_components/ui/empty-state";
import StatusBadge from "../../../_components/ui/status-badge";
import { Link } from "../../../../i18n/navigation";
import { requireRoles } from "../../../../lib/dal";
import { isPhase7Ready } from "../../../../lib/phase7/readiness";
import { prisma } from "../../../../lib/prisma";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("complaintsAdmin");
  return { title: `${t("title")} | Zarabicschool` };
}

const STATUSES = ["NEW", "IN_PROGRESS", "RESOLVED"] as const;

/**
 * Complaints inbox (Phase 7, owner 2026-10-26) — ADMIN and SUPERVISOR only; the
 * ONLY list of complaints in the app (no other role has a read path).
 */
export default async function AdminComplaintsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const [t, locale] = await Promise.all([getTranslations("complaintsAdmin"), getLocale()]);
  const { status } = await searchParams;
  const statusFilter = STATUSES.find((value) => value === status);

  if (!(await isPhase7Ready())) {
    return (
      <DashboardShell role={user.role} userName={user.displayName}>
        <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
        <EmptyState icon="hourglass_top" title={t("pendingTitle")} description={t("pendingText")} />
      </DashboardShell>
    );
  }

  const [complaints, counts] = await Promise.all([
    prisma.complaint.findMany({
      where: { academyId: user.academyId, ...(statusFilter ? { status: statusFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        createdAt: true,
        filedByRole: true,
        concernedRole: true,
        filedBy: { select: { displayName: true } },
        concernedUser: { select: { displayName: true } },
        session: { select: { scheduledStart: true } },
      },
    }),
    prisma.complaint.groupBy({ by: ["status"], where: { academyId: user.academyId }, _count: { _all: true } }),
  ]);
  const countFor = (value: string) => counts.find((row) => row.status === value)?._count._all ?? 0;

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">{t("subtitle")}</p>

      <nav className="mt-4 flex flex-wrap gap-2" aria-label={t("filterLabel")}>
        <Link href="/admin/complaints" className={`btn ${statusFilter ? "btn-soft" : "btn-primary"} px-3 py-1 text-xs`}>
          {t("all")}
        </Link>
        {STATUSES.map((value) => (
          <Link key={value} href={`/admin/complaints?status=${value}`} className={`btn ${statusFilter === value ? "btn-primary" : "btn-soft"} px-3 py-1 text-xs`}>
            {t(`status.${value}`)} ({countFor(value)})
          </Link>
        ))}
      </nav>

      <section className="mt-4 flex flex-col gap-2">
        {complaints.length === 0 ? (
          <EmptyState icon="inbox" title={t("emptyTitle")} description={t("emptyText")} />
        ) : (
          complaints.map((complaint) => (
            <Link key={complaint.id} href={`/admin/complaints/${complaint.id}`} className="z-card flex flex-col gap-1 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-title-md text-primary">{complaint.title}</strong>
                <StatusBadge tone={complaint.status === "NEW" ? "danger" : complaint.status === "IN_PROGRESS" ? "pending" : "success"}>
                  {t(`status.${complaint.status}`)}
                </StatusBadge>
              </div>
              <p className="text-body-sm text-on-surface-variant">
                {t(`category.${complaint.category}`)} · {t("filedBy", { name: complaint.filedBy.displayName, role: t(`role.${complaint.filedByRole}`) })} ·{" "}
                {complaint.concernedUser && complaint.concernedRole
                  ? t("concerning", { name: complaint.concernedUser.displayName, role: t(`role.${complaint.concernedRole}`) })
                  : t("concerningOther")}
              </p>
              <p className="text-label-sm text-outline">
                {t("sessionOf", { time: formatSessionDateTime(complaint.session.scheduledStart, user.timezone, locale) })} ·{" "}
                {t("receivedOn", { time: formatSessionDateTime(complaint.createdAt, user.timezone, locale) })}
              </p>
            </Link>
          ))
        )}
      </section>
    </DashboardShell>
  );
}
