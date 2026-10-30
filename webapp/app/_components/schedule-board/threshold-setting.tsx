"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useRouter } from "../../../i18n/navigation";
import { MAX_TEACHER_HOURS_THRESHOLD, MIN_TEACHER_HOURS_THRESHOLD } from "../../../lib/config/schedule-board";

/** Admin-only: the daily hours above which a teacher is highlighted on the board (S-16, default 6). */
export default function ThresholdSetting({ initialHours }: { initialHours: number }) {
  const t = useTranslations("scheduleBoard.threshold");
  const router = useRouter();
  const [hours, setHours] = useState(String(initialHours));
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setNote(null);
    setSaving(true);
    try {
      const response = await fetch("/api/admin/settings/teacher-hours-threshold", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hours: Number(hours) }),
      });
      if (response.ok) {
        setNote(t("saved", { hours: Number(hours) }));
        router.refresh();
      } else {
        setNote(response.status === 400 ? t("invalid", { min: MIN_TEACHER_HOURS_THRESHOLD, max: MAX_TEACHER_HOURS_THRESHOLD }) : t("error"));
      }
    } catch {
      setNote(t("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="z-card flex flex-wrap items-end gap-3 rounded-xl p-4" onSubmit={save}>
      <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
        {t("label")}
        <input
          className="z-input w-28"
          type="number"
          inputMode="numeric"
          dir="ltr"
          min={MIN_TEACHER_HOURS_THRESHOLD}
          max={MAX_TEACHER_HOURS_THRESHOLD}
          step={1}
          value={hours}
          onChange={(event) => setHours(event.target.value)}
          required
        />
      </label>
      <button type="submit" className="btn btn-soft" disabled={saving}>
        {t("save")}
      </button>
      <p className="text-body-sm text-on-surface-variant">{t("hint")}</p>
      {note ? (
        <p role="status" className="w-full text-body-sm text-on-surface-variant">
          {note}
        </p>
      ) : null}
    </form>
  );
}
