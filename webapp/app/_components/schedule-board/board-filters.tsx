"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { usePathname, useRouter } from "../../../i18n/navigation";
import { BOARD_STATUSES, DEFAULT_BOARD_STATUSES, type BoardStatus } from "../../../lib/config/schedule-board";

/**
 * Board filters (D91): date, day/week, teacher, student and status — each applies the
 * moment it is chosen (no Apply button) by replacing the URL, so the server page
 * re-renders with the new filters and the link can be shared.
 */
type Option = { id: string; name: string };

export default function BoardFilters({
  date,
  today,
  previous,
  next,
  view,
  teacherId,
  studentId,
  statuses,
  teachers,
  students,
}: {
  date: string;
  today: string;
  previous: string;
  next: string;
  view: "day" | "week";
  teacherId?: string;
  studentId?: string;
  statuses: BoardStatus[];
  teachers: Option[];
  students: Option[];
}) {
  const t = useTranslations("scheduleBoard");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const statusLabel = {
    SCHEDULED: t("status.scheduled"),
    COMPLETED: t("status.completed"),
    CANCELLED: t("status.cancelled"),
    MISSED: t("status.missed"),
  } as const;

  function apply(changes: Record<string, string | null>) {
    const params = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  function toggleStatus(status: BoardStatus, on: boolean) {
    const nextStatuses = on ? [...new Set([...statuses, status])] : statuses.filter((item) => item !== status);
    if (nextStatuses.length === 0) return; // at least one status stays selected
    const ordered = BOARD_STATUSES.filter((item) => nextStatuses.includes(item));
    const isDefault = ordered.length === DEFAULT_BOARD_STATUSES.length && ordered.every((item) => DEFAULT_BOARD_STATUSES.includes(item));
    apply({ status: isDefault ? null : ordered.join(",") });
  }

  const field = "flex flex-col gap-1 text-label-sm text-on-surface-variant";
  return (
    <div className="z-card space-y-3 rounded-xl p-4" aria-busy={pending}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-outline" onClick={() => apply({ date: previous })}>{t("filters.previous")}</button>
          <button type="button" className="btn btn-outline" onClick={() => apply({ date: today })}>{t("filters.today")}</button>
          <button type="button" className="btn btn-outline" onClick={() => apply({ date: next })}>{t("filters.next")}</button>
        </div>
        <label className={field}>
          {t("filters.date")}
          <input type="date" className="z-input" dir="ltr" value={date} onChange={(event) => event.target.value && apply({ date: event.target.value })} />
        </label>
        <label className={field}>
          {t("filters.view")}
          <select className="z-input" value={view} onChange={(event) => apply({ view: event.target.value === "week" ? "week" : null })}>
            <option value="day">{t("filters.day")}</option>
            <option value="week">{t("filters.week")}</option>
          </select>
        </label>
        <label className={field}>
          {t("filters.teacher")}
          <select className="z-input" value={teacherId ?? ""} onChange={(event) => apply({ teacherId: event.target.value || null })}>
            <option value="">{t("filters.allTeachers")}</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
            ))}
          </select>
        </label>
        <label className={field}>
          {t("filters.student")}
          <select className="z-input" value={studentId ?? ""} onChange={(event) => apply({ studentId: event.target.value || null })}>
            <option value="">{t("filters.allStudents")}</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>{student.name}</option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-label-sm text-on-surface-variant">{t("filters.status")}</legend>
        {BOARD_STATUSES.map((status) => (
          <label key={status} className="flex items-center gap-1.5 text-body-sm text-on-surface">
            <input type="checkbox" checked={statuses.includes(status)} onChange={(event) => toggleStatus(status, event.target.checked)} />
            {statusLabel[status]}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
