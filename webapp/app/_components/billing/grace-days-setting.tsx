"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useRouter } from "../../../i18n/navigation";
import { MAX_RENEWAL_GRACE_DAYS, MIN_RENEWAL_GRACE_DAYS } from "../../../lib/config/renewal-grace";

/** Admin-only: days of grace after a failed renewal before new bookings are blocked (D96, default 3). */
export default function GraceDaysSetting({ initialDays }: { initialDays: number }) {
  const t = useTranslations("renewal.graceSetting");
  const router = useRouter();
  const [days, setDays] = useState(String(initialDays));
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setNote(null);
    setSaving(true);
    try {
      const response = await fetch("/api/admin/settings/renewal-grace-days", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days: Number(days) }),
      });
      if (response.ok) {
        setNote(t("saved", { days: Number(days) }));
        router.refresh();
      } else {
        setNote(response.status === 400 ? t("invalid", { min: MIN_RENEWAL_GRACE_DAYS, max: MAX_RENEWAL_GRACE_DAYS }) : t("error"));
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
          min={MIN_RENEWAL_GRACE_DAYS}
          max={MAX_RENEWAL_GRACE_DAYS}
          step={1}
          value={days}
          onChange={(event) => setDays(event.target.value)}
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
