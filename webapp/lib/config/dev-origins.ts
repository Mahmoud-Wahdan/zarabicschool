/**
 * Dev-only `allowedDevOrigins` for next.config.ts (M-3, owner 2026-10-27): the host of
 * APP_PUBLIC_URL (e.g. the ngrok tunnel) instead of a hard-coded tunnel name. Pure
 * (no imports) so next.config.ts can load it. localhost is already allowed by Next.
 */
export function devAllowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const value = env.APP_PUBLIC_URL?.trim();
  if (!value) return [];
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return [];
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return [];
    return [parsed.hostname];
  } catch {
    return [];
  }
}
