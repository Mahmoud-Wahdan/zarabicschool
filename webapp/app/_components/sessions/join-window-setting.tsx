"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { MAX_JOIN_WINDOW_MINUTES, MIN_JOIN_WINDOW_MINUTES } from "../../../lib/config/session-join";

/**
 * Admin-only join-window setting (D4, OQ-4): minutes before the start when the join
 * link opens for teachers, students and guardians. Saving also re-times the queued
 * WhatsApp reminders of upcoming sessions (server side).
 */
export default function JoinWindowSetting({ initialMinutes }: { initialMinutes: number }) {
  const t = useTranslations("sessionsAdmin.joinWindow");
  const [minutes, setMinutes] = useState(String(initialMinutes));
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setNote(null);
    setSaving(true);
    try {
      const response = await fetch("/api/admin/settings/join-window", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minutes: Number(minutes) }),
      });
      if (response.ok) {
        const payload = (await response.json()) as { data: { minutes: number; retimedReminders: number } };
        setNote(t("saved", { minutes: payload.data.minutes, count: payload.data.retimedReminders }));
      } else {
        setNote(response.status === 400 ? t("invalid", { min: MIN_JOIN_WINDOW_MINUTES, max: MAX_JOIN_WINDOW_MINUTES }) : t("error"));
      }
    } catch {
      setNote(t("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="z-card space-y-3 rounded-xl p-4" onSubmit={save}>
      <h2 className="text-title-md font-bold text-primary">{t("title")}</h2>
      <p className="text-body-sm text-on-surface-variant">{t("hint", { min: MIN_JOIN_WINDOW_MINUTES, max: MAX_JOIN_WINDOW_MINUTES })}</p>
      <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
        {t("label")}
        <input
          className="z-input w-full max-w-40"
          type="number"
          inputMode="numeric"
          dir="ltr"
          min={MIN_JOIN_WINDOW_MINUTES}
          max={MAX_JOIN_WINDOW_MINUTES}
          step={1}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          required
        />
      </label>
      <button type="submit" className="btn btn-soft" disabled={saving}>
        {t("save")}
      </button>
      {note ? (
        <p role="status" className="text-body-sm text-on-surface-variant">
          {note}
        </p>
      ) : null}
    </form>
  );
}
