import type { MessagingProvider, MessagingSendResult } from "../../lib/messaging/types";

/**
 * Test-only MessagingProvider (Phase 8, owner 2026-10-26: tests never call OpenWA).
 * Installed for EVERY suite by `fake-messaging.setup.ts` (jest setupFilesAfterEnv),
 * which replaces `getMessagingProvider()`.
 *
 * It mirrors the OpenWA adapter's documented contract without any network:
 *  - no phone → permanent failure, like the adapter;
 *  - OPENWA_URL / OPENWA_API_KEY / OPENWA_SESSION_ID missing → the adapter's
 *    permanent "OpenWA is not configured." failure (tests that unset them keep
 *    exercising the FAILED path);
 *  - otherwise the send is recorded (ids and lengths only) and succeeds.
 * `failNext()` forces the next send to fail with a chosen error.
 */
type SentRecord = { kind: "text" | "credentials"; userId: string; messageLength: number };

let sent: SentRecord[] = [];
let forcedFailure: MessagingSendResult | null = null;
let counter = 0;

export const fakeMessaging = {
  get sent(): readonly SentRecord[] {
    return sent;
  },
  failNext(error = "Fake provider failure.", transient = false) {
    forcedFailure = { ok: false, error, transient };
  },
  reset() {
    sent = [];
    forcedFailure = null;
  },
};

function configured() {
  return Boolean(process.env.OPENWA_URL && process.env.OPENWA_API_KEY && process.env.OPENWA_SESSION_ID);
}

function send(kind: SentRecord["kind"], userId: string, phone: string | null, messageLength: number): MessagingSendResult {
  if (forcedFailure) {
    const failure = forcedFailure;
    forcedFailure = null;
    return failure;
  }
  if (!phone) return { ok: false, error: "Recipient has no phone number." };
  if (!configured()) return { ok: false, error: "OpenWA is not configured." };
  counter += 1;
  sent.push({ kind, userId, messageLength });
  return { ok: true, providerMessageId: `fake-${counter}` };
}

export const fakeMessagingProvider: MessagingProvider = {
  async sendText(recipient, message) {
    return send("text", recipient.userId, recipient.phone, message.length);
  },
  async sendCredentials(recipient, credentials) {
    return send("credentials", recipient.userId, recipient.phone, credentials.username.length);
  },
};
