import { getLocale, getTranslations } from "next-intl/server";

import AnnouncementComposer from "../../../_components/announcements/announcement-composer";
import DashboardShell from "../../../_components/dashboard-shell";
import EmptyState from "../../../_components/ui/empty-state";
import { getAnnouncementDeliveryCounts, getAnnouncementHistory } from "../../../../lib/announcements/service";
import { ANNOUNCEMENT_DEFAULT_EXPIRY_DAYS, ANNOUNCEMENT_MAX_PER_DAY } from "../../../../lib/config/announcements";
import { requireRoles } from "../../../../lib/dal";
import { isPhase7Ready } from "../../../../lib/phase7/readiness";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("announcementsAdmin");
  return { title: `${t("title")} | Zarabicschool` };
}

/**
 * Announcements (Phase 7, owner 2026-10-26) — ADMIN and SUPERVISOR compose and see
 * the history with a redacted delivery summary (job counts by status only).
 */
export default async function AdminAnnouncementsPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const [t, locale] = await Promise.all([getTranslations("announcementsAdmin"), getLocale()]);

  if (!(await isPhase7Ready())) {
    return (
      <DashboardShell role={user.role} userName={user.displayName}>
        <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
        <EmptyState icon="hourglass_top" title={t("pendingTitle")} description={t("pendingText")} />
      </DashboardShell>
    );
  }

  const history = await getAnnouncementHistory(user.academyId, 30);
  const delivery = await getAnnouncementDeliveryCounts(user.academyId, history.map((row) => row.id));
  const now = new Date();

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">{t("subtitle")}</p>
      <div className="mt-4">
        <AnnouncementComposer defaultExpiryDays={ANNOUNCEMENT_DEFAULT_EXPIRY_DAYS} maxPerDay={ANNOUNCEMENT_MAX_PER_DAY} />
      </div>
      <section className="mt-6 flex flex-col gap-2">
        <h2 className="text-title-md font-bold text-primary">{t("historyTitle")}</h2>
        {history.length === 0 ? (
          <EmptyState icon="campaign" title={t("emptyTitle")} />
        ) : (
          history.map((row) => {
            const counts = delivery.get(row.id) ?? {};
            return (
              <article key={row.id} className="z-card flex flex-col gap-1 rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-title-md text-primary">{row.title}</strong>
                  <span className="text-label-sm text-outline">
                    {formatSessionDateTime(row.sentAt, user.timezone, locale)} · {row.authorName}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-body-sm">{row.body}</p>
                <p className="text-label-sm text-on-surface-variant">
                  {row.expiresAt > now
                    ? t("visibleUntil", { time: formatSessionDateTime(row.expiresAt, user.timezone, locale) })
                    : t("expired")}{" "}
                  ·{" "}
                  {t("deliverySummary", {
                    sent: counts.SENT ?? 0,
                    pending: (counts.PENDING ?? 0) + (counts.PROCESSING ?? 0),
                    failed: counts.FAILED ?? 0,
                  })}
                </p>
              </article>
            );
          })
        )}
      </section>
    </DashboardShell>
  );
}
