import "server-only";

// import { consoleProvider } from "./console-provider";
import { openWaProvider } from "./openwa-provider";
import type { MessagingProvider } from "./types";

/**
 * OpenWA is the only production messaging provider. Outside production,
 * MESSAGING_PROVIDER=console selects the local console provider (owner-approved,
 * 2026-10-26/27): it sends nothing and prints the full development message with
 * temporary passwords and raw Zoom links masked, the recipient as user id + last 3
 * digits. In production the selector always returns OpenWA, and a production start
 * with console/fake configured fails earlier (lib/config/messaging-mode.ts, the same
 * trimmed, lower-cased comparison). "fake" exists only inside the Jest suite. A future
 * second provider is resolved here and nowhere else — callers never import a
 * concrete provider.
 *
 * A missing OPENWA_* configuration never throws and never rolls anything
 * back: OpenWAProvider answers { ok: false, error: "OpenWA is not configured." }
 * and the caller records a redacted FAILED notification_jobs row (the job
 * table doubles as the NotificationLog — no message content is ever stored).
 */
export function getMessagingProvider(): MessagingProvider {
  return openWaProvider;
}
