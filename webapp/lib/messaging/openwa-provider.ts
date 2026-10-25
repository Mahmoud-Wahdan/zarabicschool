import "server-only";

import type {
  MessagingCredentials,
  MessagingProvider,
  MessagingRecipient,
  MessagingSendResult,
} from "./types";

export class OpenWAProvider implements MessagingProvider {
  private async send(recipient: MessagingRecipient, message: string): Promise<MessagingSendResult> {
    if (!recipient.phone) return { ok: false, error: "Recipient has no phone number." };
    const baseUrl = process.env.OPENWA_URL;
    const apiKey = process.env.OPENWA_API_KEY;
    const sessionId = process.env.OPENWA_SESSION_ID;
    if (!baseUrl || !apiKey || !sessionId) {
      return { ok: false, error: "OpenWA is not configured." };
    }

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/sendText`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ sessionId, chatId: recipient.phone, text: message }),
      });
      if (!response.ok) return { ok: false, error: `OpenWA returned HTTP ${response.status}.` };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "OpenWA request failed." };
    }
  }

  sendCredentials(recipient: MessagingRecipient, credentials: MessagingCredentials) {
    return this.send(recipient, `Your Zarabicschool username is ${credentials.username}. Temporary password: ${credentials.tempPassword}`);
  }

  sendText(recipient: MessagingRecipient, message: string) {
    return this.send(recipient, message);
  }
}

export const openWaProvider: MessagingProvider = new OpenWAProvider();
