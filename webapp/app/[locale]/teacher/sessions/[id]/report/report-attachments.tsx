"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import Icon from "../../../../../_components/ui/icon";

export type AttachmentItem = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Attachment list + uploader for one report. Uploads go through
 * POST /api/reports/:id/attachments (server validates MIME by magic bytes and
 * the 10 MB cap); opening uses the short-lived signed-URL endpoint.
 */
export default function ReportAttachments({
  reportId,
  initial,
  editable,
  title,
}: {
  reportId: string;
  initial: AttachmentItem[];
  editable: boolean;
  /** Optional heading override (the report-language label when a report language is active). */
  title?: string;
}) {
  const t = useTranslations("teacherReport.attachments");
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function open(attachmentId: string) {
    setError("");
    const response = await fetch(`/api/reports/${reportId}/attachments/${attachmentId}`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error?.message ?? t("errorGeneric"));
      return;
    }
    window.open(payload.data.url, "_blank", "noopener,noreferrer");
  }

  async function upload(files: FileList) {
    if (!files.length) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    Array.from(files).forEach((file) => form.append("files", file));
    const response = await fetch(`/api/reports/${reportId}/attachments`, { method: "POST", body: form });
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error?.message ?? t("errorGeneric"));
      return;
    }
    const listResponse = await fetch(`/api/reports/${reportId}/attachments`);
    if (listResponse.ok) {
      const listPayload = await listResponse.json();
      setItems(listPayload.data ?? []);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <p className="text-label-md font-bold text-primary">{title ?? t("title")}</p>
      {items.length === 0 ? <p className="text-body-sm text-on-surface-variant">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between rounded-lg bg-surface-container px-3 py-2 text-body-sm">
            <span className="min-w-0 truncate">{item.originalName}</span>
            <span className="flex items-center gap-2 text-label-sm text-on-surface-variant">
              <span>{formatSize(item.sizeBytes)}</span>
              <button type="button" onClick={() => open(item.id)} className="btn btn-soft px-2 py-1 text-xs">
                <Icon name="open_in_new" size={14} />
                {t("open")}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {editable ? (
        <label className="flex flex-col gap-1 text-body-sm">
          <span className="text-on-surface-variant">{t("uploadHint")}</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={busy}
            onChange={(event) => event.target.files && upload(event.target.files)}
            className="w-full rounded-lg border border-outline-variant px-3 py-2 text-body-sm"
          />
        </label>
      ) : null}
      {busy ? <p className="text-body-sm text-on-surface-variant">{t("uploading")}</p> : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
          {error}
        </p>
      ) : null}
    </section>
  );
}
