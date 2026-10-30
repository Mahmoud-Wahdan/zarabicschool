import { getLocale, getTranslations } from "next-intl/server";

import { getActiveAnnouncements } from "../../../lib/announcements/service";
import { isPhase7Ready } from "../../../lib/phase7/readiness";
import { formatSessionDateTime } from "../../../lib/schedules/display";
import { Link } from "../../../i18n/navigation";
import Icon from "../ui/icon";

/**
 * Dashboard widget (every role): announcements whose in-app copy has not expired.
 * Renders nothing when there are none or before the Phase 7 migration.
 */
export default async function AnnouncementsWidget({ academyId, timeZone }: { academyId: string; timeZone: string }) {
  if (!(await isPhase7Ready())) return null;
  const announcements = await getActiveAnnouncements(academyId);
  if (!announcements.length) return null;
  const [t, locale] = await Promise.all([getTranslations("announcementsWidget"), getLocale()]);
  return (
    <section className="mt-4 rounded-xl border border-[var(--line)] bg-surface-container-lowest p-5" aria-label={t("title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-[var(--navy)]">
          <Icon name="campaign" size={18} />
          {t("title")}
        </h2>
        <Link href="/announcements" className="text-xs text-[var(--emerald)] underline-offset-2 hover:underline">
          {t("history")}
        </Link>
      </div>
      <ul className="mt-3 flex flex-col gap-3">
        {announcements.map((row) => (
          <li key={row.id} className="rounded-lg bg-[var(--background)] p-3 text-sm">
            <p className="font-semibold">{row.title}</p>
            <p className="mt-1 whitespace-pre-wrap opacity-80">{row.body}</p>
            <p className="mt-1 text-xs opacity-60">{formatSessionDateTime(row.sentAt, timeZone, locale)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
