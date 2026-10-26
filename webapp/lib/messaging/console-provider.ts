import "server-only";

import type { MessagingCredentials, MessagingProvider, MessagingRecipient, MessagingSendResult } from "./types";

/**
 * Local-development messaging provider (owner, 2026-10-26/27): nothing is sent; each
 * "send" is printed to the dev console and reported as delivered, so the worker,
 * retries and delivery states can be exercised without OpenWA. Selected ONLY outside
 * production with MESSAGING_PROVIDER=console (lib/messaging/provider.ts); a
 * production start with it configured fails (lib/config/messaging-mode.ts).
 *
 * Printing rule (owner, 2026-10-27): the FULL message body is shown so the developer
 * can read it, with these masked: temporary passwords and raw Zoom links. The
 * recipient is shown as user id + the last 3 digits of the number. Message texts
 * never carry secrets, API keys, HMAC values or card data (none are composed into
 * messages), and this provider prints nothing else.
 */
const ZOOM_LINK = /https?:\/\/[^\s]*zoom\.us[^\s]*/gi;
const TEMP_PASSWORD = /(temporary password|كلمة المرور المؤقتة)\s*:\s*\S+/gi;

export function maskConsoleMessage(text: string): string {
  return text.replace(ZOOM_LINK, "[zoom link hidden]").replace(TEMP_PASSWORD, "$1: ********");
}

function recipientLabel(recipient: MessagingRecipient): string {
  const digits = (recipient.phone ?? "").replace(/\D/g, "");
  return `user ${recipient.userId} (…${digits.slice(-3)})`;
}

let counter = 0;

function deliver(recipient: MessagingRecipient, printable: string): MessagingSendResult {
  if (!recipient.phone) return { ok: false, error: "Recipient has no phone number." };
  counter += 1;
  console.info(`[whatsapp:console] NOT SENT — to ${recipientLabel(recipient)}:\n${printable}`);
  return { ok: true, providerMessageId: `console-${Date.now()}-${counter}` };
}

export const consoleProvider: MessagingProvider = {
  async sendText(recipient: MessagingRecipient, message: string) {
    return deliver(recipient, maskConsoleMessage(message));
  },
  async sendCredentials(recipient: MessagingRecipient, credentials: MessagingCredentials) {
    // Same wording as the OpenWA adapter, with the password never printed.
    const academy = credentials.academyName ? `${credentials.academyName} ` : "";
    return deliver(recipient, `Your ${academy}username is ${credentials.username}. Temporary password: ********`);
  },
};
