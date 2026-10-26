import "server-only";

import type { MessagingCredentials, MessagingProvider, MessagingRecipient, MessagingSendResult } from "./types";

/**
 * Local-development messaging provider (owner-approved, 2026-10-26): nothing is
 * sent; each "send" is logged and reported as delivered so the worker, retries and
 * delivery states can be exercised without OpenWA. Selected ONLY outside
 * production with MESSAGING_PROVIDER=console (lib/messaging/provider.ts).
 *
 * Redaction rule (CONTEXT §5/§24): the log carries the recipient's user id and the
 * message length — never the text, a phone number, a username or a password.
 */
let counter = 0;

function deliver(kind: "text" | "credentials", recipient: MessagingRecipient, length: number): MessagingSendResult {
  if (!recipient.phone) return { ok: false, error: "Recipient has no phone number." };
  counter += 1;
  console.info(`[whatsapp:console] ${kind} to user ${recipient.userId} (${length} chars) — not sent (console provider).`);
  return { ok: true, providerMessageId: `console-${Date.now()}-${counter}` };
}

export const consoleProvider: MessagingProvider = {
  async sendText(recipient: MessagingRecipient, message: string) {
    return deliver("text", recipient, message.length);
  },
  async sendCredentials(recipient: MessagingRecipient, credentials: MessagingCredentials) {
    return deliver("credentials", recipient, credentials.username.length + credentials.tempPassword.length);
  },
};
