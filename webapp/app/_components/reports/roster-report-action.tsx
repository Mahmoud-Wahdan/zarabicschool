import { getTranslations } from "next-intl/server";

import Icon from "../ui/icon";
import { Link } from "../../../i18n/navigation";
import { formatSessionDateTime } from "../../../lib/schedules/display";
import type { RosterReportStatus } from "../../../lib/reports/roster-status";

/**
 * The per-student report button on the teacher's roster rows (owner finding,
 * 2026-10-25). Pages only pass the teacher's OWN sessions. The button mirrors the
 * submit route's rules for display only — the server stays the gate:
 * before the scheduled end → disabled with the end time (viewer timezone);
 * cancelled/missed → nothing; otherwise one state per report status.
 */
export default async function RosterReportAction({
  sessionId,
  studentId,
  sessionStatus,
  scheduledEnd,
  now,
  timezone,
  locale,
  report,
}: {
  sessionId: string;
  studentId: string;
  sessionStatus: "SCHEDULED" | "COMPLETED" | "MISSED" | "CANCELLED";
  scheduledEnd: Date;
  now: Date;
  timezone: string;
  locale: string;
  report: RosterReportStatus | null;
}) {
  if (sessionStatus === "CANCELLED" || sessionStatus === "MISSED") return null;
  const t = await getTranslations("teacherReport.roster");

  if (now < scheduledEnd) {
    return (
      <span className="flex flex-col items-end gap-1">
        <button type="button" disabled className="btn btn-soft cursor-not-allowed px-3 py-1.5 text-xs opacity-60">
          <Icon name="edit_note" size={16} />
          {t("write")}
        </button>
        <span className="text-label-sm text-on-surface-variant">
          {t("availableAfter", { time: formatSessionDateTime(scheduledEnd, timezone, locale) })}
        </span>
      </span>
    );
  }

  const href = `/teacher/sessions/${sessionId}/report?studentId=${studentId}`;
  if (!report) {
    return (
      <Link href={href} className="cta-primary rounded-lg px-3 py-1.5 text-xs">
        {t("write")}
      </Link>
    );
  }
  if (report.status === "REJECTED") {
    return (
      <span className="flex flex-col items-end gap-1">
        <Link href={href} className="btn btn-primary px-3 py-1.5 text-xs">
          <Icon name="edit" size={16} />
          {t("editRejected")}
        </Link>
        {report.rejectionReason ? (
          <span className="max-w-xs text-label-sm text-error">
            {t("rejectionReason", { reason: report.rejectionReason })}
          </span>
        ) : null}
      </span>
    );
  }
  const approved = report.status === "APPROVED" || report.status === "ARCHIVED";
  return (
    <Link href={href} className="btn btn-soft px-3 py-1.5 text-xs">
      <Icon name={approved ? "verified" : "hourglass_top"} size={16} />
      {approved ? t("approved") : t("waitingReview")}
    </Link>
  );
}
