import "server-only";

import { openWaProvider } from "./openwa-provider";
import type { MessagingProvider } from "./types";

/**
 * OpenWA is the only production messaging provider (the fake provider was
 * removed, owner decision 2026-10-18). `MESSAGING_PROVIDER` remains the
 * configuration hook for future providers; a future second provider is
 * resolved here and nowhere else — callers never import a concrete provider.
 *
 * A missing OPENWA_* configuration never throws and never rolls anything
 * back: OpenWAProvider answers { ok: false, error: "OpenWA is not configured." }
 * and the caller records a redacted FAILED notification_jobs row (the job
 * table doubles as the NotificationLog — no message content is ever stored).
 */
export function getMessagingProvider(): MessagingProvider {
  return openWaProvider;
}
