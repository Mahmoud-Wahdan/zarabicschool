/**
 * Absolute platform links for outbound messages (owner, 2026-10-26): WhatsApp never
 * carries a raw Zoom link — it carries the platform's authorized join redirect
 * (/api/sessions/<id>/join), which checks the role and the join window, logs the
 * click, and only then redirects to Zoom.
 *
 * The base is APP_PUBLIC_URL — the origin people reach the platform at (the
 * production domain, or a tunnel such as ngrok in development) — falling back to
 * NEXTAUTH_URL. Only an http(s) ORIGIN is used (any path/query is dropped). Without
 * a usable base no link is built and the message tells the reader to open the
 * platform instead.
 */
export function platformBaseUrl(): string | null {
  for (const candidate of [process.env.APP_PUBLIC_URL, process.env.NEXTAUTH_URL]) {
    const value = candidate?.trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.origin;
    } catch {
      // not a URL — try the next candidate
    }
  }
  return null;
}

export function platformUrl(path: string): string | null {
  const base = platformBaseUrl();
  if (!base) return null;
  return new URL(path, base).toString();
}

export function sessionJoinPlatformUrl(sessionId: string): string | null {
  return platformUrl(`/api/sessions/${encodeURIComponent(sessionId)}/join`);
}
