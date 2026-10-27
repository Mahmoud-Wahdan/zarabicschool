/**
 * Where a reader may be sent back after signing in (I-1 / D4, owner 2026-10-27):
 * only a same-site PATH from a small allowlist — the session join redirect or a
 * localized in-app page. Anything else (absolute URLs, protocol-relative "//",
 * backslashes, other API routes, control characters) is refused, so the login
 * page can never be used as an open redirect.
 */
const MAX_LENGTH = 512;
const JOIN_PATH = /^\/api\/sessions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/join(\?host=1)?$/i;
const LOCALIZED_PAGE = /^\/(ar|en)(\/[A-Za-z0-9\-_./]*)?(\?[A-Za-z0-9\-_.=&%]*)?$/;

export function safeCallbackPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) return null;
  if (value.includes("//") || value.includes("\\")) return null;
  if (JOIN_PATH.test(value) || LOCALIZED_PAGE.test(value)) return value;
  return null;
}
