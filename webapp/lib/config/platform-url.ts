/**
 * Absolute platform links for outbound messages (owner, 2026-10-26): WhatsApp never
 * carries a raw Zoom link — it carries the platform's authorized join redirect
 * (/api/sessions/<id>/join), which checks the role and the join window, logs the
 * click, and only then redirects to Zoom.
 *
 * The base is NEXTAUTH_URL (the platform's public origin). Without it no link is
 * built and the message tells the reader to open the platform instead.
 */
export function platformUrl(path: string): string | null {
  const base = process.env.NEXTAUTH_URL?.trim();
  if (!base) return null;
  try {
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}

export function sessionJoinPlatformUrl(sessionId: string): string | null {
  return platformUrl(`/api/sessions/${encodeURIComponent(sessionId)}/join`);
}
