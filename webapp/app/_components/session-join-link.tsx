import { getTranslations } from "next-intl/server";

import { JOIN_OPENS_BEFORE_START_MINUTES, type JoinWindowState } from "../../lib/config/session-join";

/**
 * Window-aware "Open Zoom" control for role session pages (server component — no client
 * JS). The button is rendered as a link only inside the join window; outside it, a
 * disabled control with a localized hint is shown instead, so users never land on the
 * JSON error the /join route returns outside the window. The /join route remains the
 * authority (defense in depth).
 */
export default async function SessionJoinLink({
  sessionId,
  state,
  label,
  host = false,
  compact = false,
}: {
  sessionId: string;
  state: JoinWindowState;
  label: string;
  host?: boolean;
  compact?: boolean;
}) {
  const t = await getTranslations("sessions");
  if (state === "before") {
    return (
      <span
        title={t("window.notYetOpen", { minutes: JOIN_OPENS_BEFORE_START_MINUTES })}
        aria-label={t("window.notYetOpen", { minutes: JOIN_OPENS_BEFORE_START_MINUTES })}
        className="inline-flex cursor-not-allowed items-center gap-1 rounded-xl border border-dashed border-[var(--line)] px-3 py-2 text-xs opacity-60"
      >
        <span className="material-symbols-outlined text-sm" aria-hidden="true">videocam_off</span>
        {t("window.notYetOpen", { minutes: JOIN_OPENS_BEFORE_START_MINUTES })}
      </span>
    );
  }
  if (state === "after") {
    return (
      <span className="inline-flex cursor-not-allowed items-center gap-1 rounded-xl border border-dashed border-[var(--line)] px-3 py-2 text-xs opacity-60">
        <span className="material-symbols-outlined text-sm" aria-hidden="true">videocam_off</span>
        {t("window.closed")}
      </span>
    );
  }
  return (
    <a
      href={`/api/sessions/${sessionId}/join${host ? "?host=1" : ""}`}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1 rounded-xl bg-[var(--emerald)] font-semibold text-white ${
        compact ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm"
      } hover:opacity-90`}
    >
      <span className="material-symbols-outlined text-sm" aria-hidden="true">{host ? "start" : "videocam"}</span>
      {label}
    </a>
  );
}
