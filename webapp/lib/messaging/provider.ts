import "server-only";

import { consoleProvider } from "./console-provider";
import { openWaProvider } from "./openwa-provider";
import type { MessagingProvider } from "./types";

/**
 * OpenWA is the only production messaging provider (the old fake provider was
 * removed, owner decision 2026-10-18). Outside production, MESSAGING_PROVIDER=console
 * selects the local console provider (owner-approved, 2026-10-26): it logs ids and
 * lengths only and sends nothing. In production the variable is IGNORED — OpenWA
 * always. A future second provider is resolved here and nowhere else — callers never
 * import a concrete provider.
 *
 * A missing OPENWA_* configuration never throws and never rolls anything
 * back: OpenWAProvider answers { ok: false, error: "OpenWA is not configured." }
 * and the caller records a redacted FAILED notification_jobs row (the job
 * table doubles as the NotificationLog — no message content is ever stored).
 */
export function getMessagingProvider(): MessagingProvider {
  if (process.env.NODE_ENV !== "production" && process.env.MESSAGING_PROVIDER === "console") {
    return consoleProvider;
  }
  return openWaProvider;
}
