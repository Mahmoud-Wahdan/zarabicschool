"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { REPORT_LANGUAGE_OPTIONS, type ReportLanguageCode } from "../../../lib/reports/report-language";

export type EditorRemarkOption = {
  slug: string;
  labels: Partial<Record<ReportLanguageCode, string>>;
};

/** Deterministic slug from the English label (fallback remark_N when not ASCII). */
function slugFromEnglishLabel(label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || `remark_${index + 1}`;
}

/**
 * Admin-only editor for the academy's class-remark list (owner decision 2026-10-14 —
 * Supervisors are excluded from system settings). Session 1 (owner, 2026-10-18):
 * every option carries a label per report language (ar/en/fr/de/tr — CONTEXT §9);
 * the slug is derived from the English label and stored on reports.
 */
export default function ClassRemarksEditor({ initialItems }: { initialItems: EditorRemarkOption[] }) {
  const t = useTranslations("reportsQueue");
  const router = useRouter();
  const [items, setItems] = useState<EditorRemarkOption[]>(initialItems);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function updateLabel(index: number, language: ReportLanguageCode, value: string) {
    setItems((current) =>
      current.map((item, i) => {
        if (i !== index) return item;
        const labels = { ...item.labels, [language]: value };
        return { slug: slugFromEnglishLabel(labels.en ?? "", index), labels };
      }),
    );
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, i) => i !== index));
  }

  function addItem() {
    setItems((current) => {
      const labels: Partial<Record<ReportLanguageCode, string>> = {};
      for (const option of REPORT_LANGUAGE_OPTIONS) labels[option.value] = "";
      return [...current, { slug: `remark_${current.length + 1}`, labels }];
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/admin/settings/class-remarks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map((item, index) => ({
          slug: item.slug || slugFromEnglishLabel(item.labels.en ?? "", index),
          labels: {
            ar: item.labels.ar ?? "",
            en: item.labels.en ?? "",
            fr: item.labels.fr ?? "",
            de: item.labels.de ?? "",
            tr: item.labels.tr ?? "",
          },
        })),
      }),
    });
    setSaving(false);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error?.message ?? t("remarksError"));
      return;
    }
    setItems(payload.data.items);
    setMessage(t("remarksSaved"));
    router.refresh();
  }

  return (
    <section className="z-card flex flex-col gap-3 rounded-xl p-4">
      <div>
        <h2 className="text-title-md font-bold text-primary">{t("remarksTitle")}</h2>
        <p className="text-body-sm text-on-surface-variant">{t("remarksHint")}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {items.map((item, index) => (
          <li key={item.slug || index} className="flex flex-col gap-2 rounded-lg bg-surface-container-lowest p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded bg-surface-container-high px-2 py-0.5 font-mono text-label-sm text-on-surface-variant">{item.slug}</span>
              <button type="button" onClick={() => removeItem(index)} className="btn btn-ghost-danger px-2 py-1 text-xs">
                {t("remarksRemove")}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {REPORT_LANGUAGE_OPTIONS.map((language) => (
                <label key={language.value} className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
                  {language.nativeName}
                  <input
                    value={item.labels[language.value] ?? ""}
                    onChange={(event) => updateLabel(index, language.value, event.target.value)}
                    maxLength={120}
                    className="z-input w-full"
                    aria-label={`${t("remarksTitle")} ${item.slug} ${language.nativeName}`}
                  />
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={addItem} className="btn btn-soft whitespace-nowrap">
          {t("remarksAdd")}
        </button>
      </div>
      <button type="button" onClick={save} disabled={saving || items.length === 0} className="btn btn-primary self-start">
        {saving ? t("saving") : t("remarksSave")}
      </button>
      {message ? <p role="status" className="text-body-sm text-secondary">{message}</p> : null}
      {error ? <p role="alert" className="text-body-sm text-error">{error}</p> : null}
    </section>
  );
}
