"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import Icon from "../ui/icon";

export type AttachmentListItem = { id: string; originalName: string };

/**
 * Read-only attachment list for report viewers (student, guardian, admin). "Open"
 * asks the server for a short-lived signed URL; the server re-runs the report
 * visibility check on every request, so the URL is never stored or reused.
 */
export default function AttachmentList({ reportId, items }: { reportId: string; items: AttachmentListItem[] }) {
  const t = useTranslations("teacherReport.attachments");
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  async function open(attachmentId: string) {
    setError("");
    setOpening(attachmentId);
    const response = await fetch(`/api/reports/${reportId}/attachments/${attachmentId}`);
    const payload = await response.json().catch(() => null);
    setOpening(null);
    if (!response.ok || typeof payload?.data?.url !== "string") {
      setError(t("errorGeneric"));
      return;
    }
    window.open(payload.data.url, "_blank", "noopener,noreferrer");
  }

  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-container px-3 py-2 text-body-sm">
            <span className="min-w-0 truncate">{item.originalName}</span>
            <button
              type="button"
              onClick={() => open(item.id)}
              disabled={opening === item.id}
              className="btn btn-soft px-2 py-1 text-xs"
            >
              <Icon name="open_in_new" size={14} />
              {t("open")}
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
