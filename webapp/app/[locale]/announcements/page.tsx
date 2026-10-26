import { getLocale, getTranslations } from "next-intl/server";

import DashboardShell from "../../_components/dashboard-shell";
import EmptyState from "../../_components/ui/empty-state";
import { getAnnouncementHistory } from "../../../lib/announcements/service";
import { requireRoles, studentFinanceBlocked } from "../../../lib/dal";
import { isPhase7Ready } from "../../../lib/phase7/readiness";
import { formatSessionDateTime } from "../../../lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("announcementsWidget");
  return { title: `${t("historyTitle")} | Zarabicschool` };
}

/** Announcement history for every signed-in role (expiry hides only the widget copy). */
export default async function AnnouncementsHistoryPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  const [t, locale] = await Promise.all([getTranslations("announcementsWidget"), getLocale()]);
  const financeHidden = user.role === "STUDENT" ? await studentFinanceBlocked(user.id) : false;
  const history = (await isPhase7Ready()) ? await getAnnouncementHistory(user.academyId) : [];
  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone} hideNavKeys={financeHidden ? ["invoices"] : undefined}>
      <h1 className="text-headline-md font-bold text-primary">{t("historyTitle")}</h1>
      <section className="mt-4 flex flex-col gap-2">
        {history.length === 0 ? (
          <EmptyState icon="campaign" title={t("empty")} />
        ) : (
          history.map((row) => (
            <article key={row.id} className="z-card rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-title-md text-primary">{row.title}</strong>
                <span className="text-label-sm text-outline">{formatSessionDateTime(row.sentAt, user.timezone, locale)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-body-sm">{row.body}</p>
            </article>
          ))
        )}
      </section>
    </DashboardShell>
  );
}
