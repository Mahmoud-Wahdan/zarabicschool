"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

type Probe = { reachable: boolean; httpStatus: number | null; status: string | null } | null;
type Health = { configured: boolean; health: Probe; ready: Probe };
type Recipient = { id: string; displayName: string; username: string; role: string };

const ERROR_KEYS: Record<string, string> = {
  RATE_LIMITED: "errorRateLimited",
  RECIPIENT_NO_PHONE: "errorNoPhone",
  VALIDATION_ERROR: "errorValidation",
  WHATSAPP_MIGRATION_PENDING: "migrationPending",
};

export default function WhatsAppAdminPanel({
  ready,
  initialContactNumber,
  recipients,
}: {
  ready: boolean;
  initialContactNumber: string;
  recipients: Recipient[];
}) {
  const t = useTranslations("whatsappAdmin");
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const [contact, setContact] = useState(initialContactNumber);
  const [contactNote, setContactNote] = useState<string | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [body, setBody] = useState("");
  const [messageNote, setMessageNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function errorText(response: Response) {
    const payload = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    const key = payload?.error?.code ? ERROR_KEYS[payload.error.code] : undefined;
    return t(key ?? "error");
  }

  async function checkHealth() {
    setChecking(true);
    try {
      const response = await fetch("/api/admin/whatsapp/health", { cache: "no-store" });
      setHealth(response.ok ? ((await response.json()) as { data: Health }).data : null);
    } catch {
      setHealth(null);
    } finally {
      setChecking(false);
    }
  }

  async function saveContact(event: React.FormEvent) {
    event.preventDefault();
    setContactNote(null);
    try {
      const response = await fetch("/api/admin/settings/whatsapp-number", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ number: contact }),
      });
      setContactNote(response.ok ? t("contactSaved") : await errorText(response));
    } catch {
      setContactNote(t("error"));
    }
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    setMessageNote(null);
    setSending(true);
    try {
      const response = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipientUserId: recipientId, body }),
      });
      if (response.ok) {
        setBody("");
        setMessageNote(t("messageQueued"));
      } else {
        setMessageNote(await errorText(response));
      }
    } catch {
      setMessageNote(t("error"));
    } finally {
      setSending(false);
    }
  }

  function probeLine(label: string, probe: Probe) {
    return (
      <li className="flex items-center justify-between gap-3">
        <span className="text-on-surface-variant">{label}</span>
        <span className="font-semibold text-on-surface">
          {probe?.reachable ? `${probe.status ?? "—"} (HTTP ${probe.httpStatus})` : t("healthUnreachable")}
        </span>
      </li>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="z-card space-y-3 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-title-md font-bold text-primary">{t("healthTitle")}</h2>
          <button type="button" className="btn btn-soft" onClick={checkHealth} disabled={checking}>
            {t("healthCheck")}
          </button>
        </div>
        {health && !health.configured ? (
          <p className="text-body-sm text-on-surface-variant">{t("healthNotConfigured")}</p>
        ) : null}
        {health && health.configured ? (
          <ul className="space-y-1 text-body-sm">
            {probeLine(t("healthLive"), health.health)}
            {probeLine(t("healthReady"), health.ready)}
          </ul>
        ) : null}
      </section>

      <form className="z-card space-y-3 rounded-xl p-4" onSubmit={saveContact}>
        <h2 className="text-title-md font-bold text-primary">{t("contactTitle")}</h2>
        <p className="text-body-sm text-on-surface-variant">{t("contactHint")}</p>
        <input
          className="z-input w-full"
          dir="ltr"
          inputMode="tel"
          aria-label={t("contactTitle")}
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          maxLength={32}
          required
        />
        <button type="submit" className="btn btn-soft">
          {t("contactSave")}
        </button>
        {contactNote ? (
          <p role="status" className="text-body-sm text-on-surface-variant">
            {contactNote}
          </p>
        ) : null}
      </form>

      <form className="z-card space-y-3 rounded-xl p-4 lg:col-span-2" onSubmit={sendMessage}>
        <h2 className="text-title-md font-bold text-primary">{t("messageTitle")}</h2>
        <p className="text-body-sm text-on-surface-variant">{ready ? t("messageHint") : t("migrationPending")}</p>
        <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
          {t("messageRecipient")}
          <select
            className="z-input"
            value={recipientId}
            onChange={(event) => setRecipientId(event.target.value)}
            required
            disabled={!ready}
          >
            <option value="">{t("messageRecipientPick")}</option>
            {recipients.map((recipient) => (
              <option key={recipient.id} value={recipient.id}>
                {recipient.displayName} · {recipient.username} · {recipient.role}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
          {t("messageBody")}
          <textarea
            className="z-input min-h-32"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={4000}
            required
            disabled={!ready}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!ready || sending}>
          {t("messageSend")}
        </button>
        {messageNote ? (
          <p role="status" className="text-body-sm text-on-surface-variant">
            {messageNote}
          </p>
        ) : null}
      </form>
    </div>
  );
}
