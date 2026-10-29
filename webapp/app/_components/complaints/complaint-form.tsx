"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type SessionOption = { id: string; label: string };
type Party = { userId: string; role: "TEACHER" | "STUDENT" | "GUARDIAN"; displayName: string };

const CATEGORIES = ["TEACHING_QUALITY", "BEHAVIOUR", "PUNCTUALITY", "TECHNICAL", "BILLING", "OTHER"] as const;

/**
 * File a complaint (student/guardian/teacher). After sending, the form shows a
 * confirmation only — the filer cannot list or reopen complaints (only Admin and
 * Supervisor can read them).
 */
export default function ComplaintForm({
  sessions,
  initialSessionId,
  initialParties = [],
}: {
  sessions: SessionOption[];
  initialSessionId?: string;
  /** Parties of the pre-selected session, resolved server-side (same rule as the API). */
  initialParties?: Party[];
}) {
  const t = useTranslations("complaintForm");
  const [sessionId, setSessionId] = useState(initialSessionId ?? "");
  const [parties, setParties] = useState<Party[]>(initialParties);
  const [concernedUserId, setConcernedUserId] = useState("");
  const [category, setCategory] = useState<string>("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  async function loadParties(id: string) {
    setSessionId(id);
    setConcernedUserId("");
    setParties([]);
    if (!id) return;
    try {
      const response = await fetch(`/api/complaints/parties?sessionId=${encodeURIComponent(id)}`);
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setParties(payload.data ?? []);
      else setMessage(payload.error?.message ?? t("error"));
    } catch {
      setMessage(t("error"));
    }
  }

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/complaints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, concernedUserId, category, title, body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error?.message ?? t("error"));
        return;
      }
      setSent(true);
    } catch {
      setMessage(t("error"));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section className="z-card mt-4 rounded-xl p-5">
        <p className="text-title-md font-bold text-primary">{t("sentTitle")}</p>
        <p className="mt-1 text-body-sm text-on-surface-variant">{t("sentText")}</p>
      </section>
    );
  }

  return (
    <form
      className="z-card mt-4 flex flex-col gap-3 rounded-xl p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="text-body-sm text-on-surface-variant">{t("privacyHint")}</p>
      <label className="flex flex-col gap-1 text-label-md font-semibold text-on-surface">
        {t("sessionLabel")}
        <select required value={sessionId} onChange={(event) => void loadParties(event.target.value)} className="z-input">
          <option value="">{t("choose")}</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-label-md font-semibold text-on-surface">
        {t("concernedLabel")}
        <select required value={concernedUserId} onChange={(event) => setConcernedUserId(event.target.value)} className="z-input" disabled={!parties.length}>
          <option value="">{t("choose")}</option>
          {parties.map((party) => (
            <option key={party.userId} value={party.userId}>
              {party.displayName} ({t(`role.${party.role}`)})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-label-md font-semibold text-on-surface">
        {t("categoryLabel")}
        <select required value={category} onChange={(event) => setCategory(event.target.value)} className="z-input">
          <option value="">{t("choose")}</option>
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t(`category.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-label-md font-semibold text-on-surface">
        {t("titleLabel")}
        <input required minLength={2} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} className="z-input" />
      </label>
      <label className="flex flex-col gap-1 text-label-md font-semibold text-on-surface">
        {t("bodyLabel")}
        <textarea required minLength={2} maxLength={4000} rows={6} value={body} onChange={(event) => setBody(event.target.value)} className="z-input" />
      </label>
      <button type="submit" disabled={busy} className="btn btn-primary self-start px-4 py-2 text-sm disabled:opacity-50">
        {t("submit")}
      </button>
      {message ? <p role="alert" className="text-body-sm text-on-error-container">{message}</p> : null}
    </form>
  );
}
