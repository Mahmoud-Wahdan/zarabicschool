"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import BoardGrid, { type BoardGridRow } from "./board-grid";

/**
 * Under the create/edit session form (S-16, D91): the chosen teacher's day as one
 * timeline row, with the session being entered as an outlined block. Display only —
 * the server's overlap check (assertTeacherFree) stays the authority.
 */
export default function TeacherDayStrip({
  teacherId,
  date,
  draft,
  timeZone,
  locale,
}: {
  teacherId: string;
  /** `YYYY-MM-DD` in the viewer's zone. */
  date: string;
  draft: { start: Date; end: Date } | null;
  timeZone: string;
  locale: string;
}) {
  const t = useTranslations("scheduleBoard.form");
  const [state, setState] = useState<{ key: string; row: BoardGridRow | null; threshold: number } | null>(null);
  const key = `${teacherId}:${date}`;

  useEffect(() => {
    if (!teacherId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const controller = new AbortController();
    fetch(`/api/admin/schedule-board?date=${date}&teacherId=${teacherId}&status=SCHEDULED,COMPLETED`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { data?: { rows: BoardGridRow[]; thresholdMinutes: number } } | null) => {
        setState({ key, row: payload?.data?.rows[0] ?? null, threshold: payload?.data?.thresholdMinutes ?? 360 });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [teacherId, date, key]);

  if (!teacherId) return null;
  if (state?.key !== key) return <p className="text-label-sm text-on-surface-variant">{t("loading")}</p>;
  if (!state.row) return null;
  const row = state.row;
  const overlap = draft
    ? row.sessions.find((session) => Date.parse(session.start) < draft.end.getTime() && Date.parse(session.end) > draft.start.getTime())
    : undefined;
  const withDraft: BoardGridRow = draft
    ? {
        ...row,
        sessions: [
          ...row.sessions,
          { id: "draft", start: draft.start.toISOString(), end: draft.end.toISOString(), status: "SCHEDULED", type: "PRIVATE", studentNames: [t("newSession")], studentCount: 1, href: "", draft: true },
        ],
      }
    : row;
  const timeOf = (iso: string) => new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <div className="space-y-2">
      <p className="text-body-sm font-semibold text-on-surface">{t("title", { teacher: row.teacherName })}</p>
      <BoardGrid rows={[withDraft]} timeZone={timeZone} locale={locale} view="day" thresholdMinutes={state.threshold} compact />
      {draft ? (
        <p role="status" className={overlap ? "text-body-sm font-semibold text-error" : "text-body-sm text-on-surface-variant"}>
          {overlap ? t("overlap", { time: timeOf(overlap.start) }) : t("free")}
        </p>
      ) : null}
    </div>
  );
}
