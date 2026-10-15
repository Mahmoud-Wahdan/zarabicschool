"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Admin-only editor for the academy's class-remark list (owner decision 2026-10-14 —
 * Supervisors are excluded from system settings). Rendered inside the reports queue
 * page; Supervisors never receive it.
 */
export default function ClassRemarksEditor({ initialItems }: { initialItems: string[] }) {
  const t = useTranslations("reportsQueue");
  const router = useRouter();
  const [items, setItems] = useState<string[]>(initialItems);
  const [newItem, setNewItem] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function updateItem(index: number, value: string) {
    setItems((current) => current.map((item, i) => (i === index ? value : item)));
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, i) => i !== index));
  }

  function addItem() {
    const value = newItem.trim();
    if (!value) return;
    setItems((current) => [...current, value]);
    setNewItem("");
  }

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/admin/settings/class-remarks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
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
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex items-center gap-2">
            <input
              value={item}
              onChange={(event) => updateItem(index, event.target.value)}
              maxLength={60}
              className="z-input w-full"
              aria-label={`${t("remarksTitle")} ${index + 1}`}
            />
            <button type="button" onClick={() => removeItem(index)} className="btn btn-ghost-danger px-2 py-1 text-xs">
              {t("remarksRemove")}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <input
          value={newItem}
          onChange={(event) => setNewItem(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addItem();
            }
          }}
          maxLength={60}
          placeholder={t("remarksAdd")}
          className="z-input w-full"
        />
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
