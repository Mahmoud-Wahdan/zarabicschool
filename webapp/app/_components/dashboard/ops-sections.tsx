import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import Icon, { type IconName } from "../ui/icon";
import { type BadgeTone } from "../ui/status-badge";

/**
 * Shared parts of the operations dashboards (Admin and Supervisor, owner 2026-10-31):
 * today's sessions and "needs you" rows. No money here.
 */

type OpsSession = {
  id: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  status: string;
  sessionType: string;
  subject: { nameAr: string; nameEn: string };
  teacher: { user: { displayName: string } };
  students: { student: { user: { displayName: string } } }[];
};

/** One row of "needs you": a count that links to where it is handled. */
export function ActionRow({ href, icon, label, count, tone }: { href: string; icon: IconName; label: string; count: number; tone: BadgeTone }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-container-low">
        <span className="flex items-center gap-2.5 text-body-md text-on-surface">
          <Icon name={icon} size={20} className="text-on-surface-variant" />
          {label}
        </span>
        <span className={`badge ${count > 0 ? `badge--${tone}` : "badge--neutral"} tabular-nums`}>{count}</span>
      </Link>
    </li>
  );
}

export async function TodayCard({ sessions, now }: { sessions: OpsSession[]; now: Date }) {
  const t = await getTranslations("adminDash");
  const live = sessions.filter((session) => session.status === "SCHEDULED" && session.scheduledStart <= now && session.scheduledEnd > now).length;
  const upcoming = sessions.filter((session) => session.status === "SCHEDULED" && session.scheduledStart > now).length;
  const done = sessions.filter((session) => session.status === "COMPLETED").length;
  return (
    <section className="z-card flex flex-col rounded-xl p-4 sm:p-6" aria-labelledby="dash-today">
      <h2 id="dash-today" className="text-title-md font-semibold text-on-surface-variant">{t("todayTitle")}</h2>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="text-display-hero font-bold leading-none text-primary tabular-nums">{sessions.length}</span>
        <span className="text-body-md text-on-surface-variant">{t("kpiTodaySessionsUnit")}</span>
      </p>
      <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-outline-variant pt-4">
        <div>
          <dt className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
            <span className={`h-2 w-2 rounded-full ${live ? "bg-secondary badge-dot--pulse" : "bg-outline-variant"}`} aria-hidden="true" />
            {t("liveNow")}
          </dt>
          <dd className="text-headline-sm font-semibold text-on-surface tabular-nums">{live}</dd>
        </div>
        <div>
          <dt className="text-label-sm text-on-surface-variant">{t("upcoming")}</dt>
          <dd className="text-headline-sm font-semibold text-on-surface tabular-nums">{upcoming}</dd>
        </div>
        <div>
          <dt className="text-label-sm text-on-surface-variant">{t("done")}</dt>
          <dd className="text-headline-sm font-semibold text-on-surface tabular-nums">{done}</dd>
        </div>
      </dl>
    </section>
  );
}

