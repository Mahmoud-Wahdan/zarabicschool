import "server-only";

import { toInternationalDigits, toWhatsAppChatId } from "./phone";
import type {
  MessagingCredentials,
  MessagingProvider,
  MessagingRecipient,
  MessagingSendOptions,
  MessagingSendResult,
} from "./types";

const SEND_TIMEOUT_MS = 20_000;

/**
 * Non-production safety net: outside NODE_ENV=production a send is allowed ONLY
 * to numbers listed in OPENWA_SEND_ALLOWLIST (comma-separated, any format the
 * phone normaliser accepts). Empty/unset outside production = nothing is sent.
 * The development database is seeded with demo phone numbers that may belong
 * to real people; a dev worker must never message them.
 */
function recipientAllowed(digits: string): boolean {
  if (process.env.NODE_ENV === "production") return true;
  const allowlist = (process.env.OPENWA_SEND_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => toInternationalDigits(entry.trim()))
    .filter((entry): entry is string => Boolean(entry));
  return allowlist.includes(digits);
}

async function sessionNotActive(response: Response): Promise<boolean> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  const text = Array.isArray(body?.message) ? body.message.join(" ") : typeof body?.message === "string" ? body.message : "";
  return /session\b.*\bnot active/i.test(text);
}

export class OpenWAProvider implements MessagingProvider {
  private async send(
    recipient: MessagingRecipient,
    message: string,
    options?: MessagingSendOptions,
  ): Promise<MessagingSendResult> {
    if (!recipient.phone) return { ok: false, error: "Recipient has no phone number." };
    const chatId = toWhatsAppChatId(recipient.phone);
    if (!chatId) return { ok: false, error: "Recipient phone number is not in a supported format." };
    if (!recipientAllowed(chatId.slice(0, -"@c.us".length))) {
      return { ok: false, error: "Recipient blocked by OPENWA_SEND_ALLOWLIST (non-production)." };
    }
    const baseUrl = process.env.OPENWA_URL;
    const apiKey = process.env.OPENWA_API_KEY;
    const sessionId = process.env.OPENWA_SESSION_ID;
    if (!baseUrl || !apiKey || !sessionId) {
      return { ok: false, error: "OpenWA is not configured." };
    }

    // OpenWA contract (read from its source): POST /api/sessions/:sessionId/messages/send-text
    // with { chatId, text }; 201 → { messageId, timestamp }.
    const url = `${baseUrl.replace(/\/$/, "")}/api/sessions/${encodeURIComponent(sessionId)}/messages/send-text`;
    const headers: Record<string, string> = { "content-type": "application/json", "X-API-Key": apiKey };
    if (options?.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ chatId, text: message }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!response.ok) {
        // 409 engine not ready, 429 pacing, 5xx/503 lookup → may succeed later.
        // 400 "Session … is not active" (G-WA-1): the WhatsApp session is down, not a bad
        // recipient → retried. Any other 400 (unregistered recipient), 401/403 key,
        // 404 session → permanent. Only OpenWA's own error text is read, never logged.
        if (response.status === 400 && (await sessionNotActive(response))) {
          return { ok: false, transient: true, error: "OpenWA session is not active (HTTP 400)." };
        }
        const transient = response.status === 409 || response.status === 429 || response.status >= 500;
        return { ok: false, transient, error: `OpenWA returned HTTP ${response.status}.` };
      }
      const body = (await response.json().catch(() => null)) as { messageId?: unknown } | null;
      const providerMessageId = typeof body?.messageId === "string" ? body.messageId.slice(0, 255) : undefined;
      return { ok: true, providerMessageId };
    } catch (error) {
      // Network/timeout errors never carry the message or the key; keep only the class.
      const name = error instanceof Error ? error.name : "Error";
      return { ok: false, transient: true, error: `OpenWA request failed (${name}).` };
    }
  }

  sendCredentials(recipient: MessagingRecipient, credentials: MessagingCredentials) {
    const academy = credentials.academyName ? `${credentials.academyName} ` : "";
    return this.send(
      recipient,
      `Your ${academy}username is ${credentials.username}. Temporary password: ${credentials.tempPassword}`,
    );
  }

  sendText(recipient: MessagingRecipient, message: string, options?: MessagingSendOptions) {
    return this.send(recipient, message, options);
  }
}

export const openWaProvider: MessagingProvider = new OpenWAProvider();
