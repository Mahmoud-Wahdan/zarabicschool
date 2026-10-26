import { useTranslations } from "next-intl";

import type { ClickTimelineEntry } from "../../../lib/sessions/click-timeline";
import Icon from "../ui/icon";

/**
 * Read-only "link click time" list (Admin/Supervisor only — the data comes from
 * lib/sessions/click-timeline.ts, which refuses every other role). Wording is
 * deliberately "link click", never arrival/attendance: a click does not prove the
 * person entered or stayed in Zoom. Contains no link.
 */
export default function ClickTimeline({
  entries,
  timeZone,
  locale,
}: {
  entries: ClickTimelineEntry[];
  timeZone: string;
  locale: string;
}) {
  const t = useTranslations("clickTimeline");
  const format = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
  const relative = (minutes: number) =>
    minutes === 0 ? t("atStart") : minutes > 0 ? t("afterStart", { minutes }) : t("beforeStart", { minutes: -minutes });
  return (
    <section className="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
      <h3 className="flex items-center gap-2 text-label-md font-semibold text-primary">
        <Icon name="ads_click" size={16} />
        {t("title")}
      </h3>
      <p className="mt-1 text-label-sm text-on-surface-variant">{t("disclaimer")}</p>
      {entries.length === 0 ? (
        <p className="mt-2 text-body-sm text-on-surface-variant">{t("empty")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {entries.map((entry, index) => (
            <li key={`${entry.userId}-${entry.clickedAt}-${index}`} className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
              <span>
                {entry.displayName} · {entry.isAssignedTeacher ? t("assignedTeacher") : t(`roles.${entry.role}`)}
              </span>
              <span className="text-on-surface-variant">
                {format.format(new Date(entry.clickedAt))} · {relative(entry.minutesFromStart)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
