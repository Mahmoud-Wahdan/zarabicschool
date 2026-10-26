type IncomingHeaders = Headers | Record<string, unknown> | undefined;

import { NextResponse } from "next/server";

function getHeader(headers: IncomingHeaders, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export function getClientIp(headers: IncomingHeaders) {
  return getHeader(headers, "x-forwarded-for")?.split(",")[0]?.trim()
    || getHeader(headers, "x-real-ip")
    || "unknown";
}

/**
 * Same-origin check for state-changing API routes.
 *
 * - Missing/invalid Origin or missing Host → false.
 * - Development: compares the Origin's host to the request Host header
 *   (fixes LAN access where request.url uses the server hostname, not the
 *   browser's Host).
 * - Production: exact string match of Origin against the comma-separated
 *   ALLOWED_ORIGINS env var. If ALLOWED_ORIGINS is empty → false (fail closed).
 *
 * Does NOT trust x-forwarded-host.
 */
export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = headers.get("host");

  if (!origin || !host) return false;

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  if (process.env.NODE_ENV !== "production") {
    // Dev/test: compare the host portion (hostname:port) of the Origin
    // against the Host header the browser actually sent.
    return parsedOrigin.host === host;
  }

  // Production: strict allowlist from ALLOWED_ORIGINS env var.
  const allowed = process.env.ALLOWED_ORIGINS;
  if (!allowed) return false; // fail closed

  const allowedList = allowed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowedList.length === 0) return false; // fail closed

  return allowedList.includes(origin);
}

/**
 * B3 (S1): the one guard for every state-changing route — `null` when the request is
 * same-origin, otherwise the 403 to return. Usage, first line of the handler:
 *   const crossOrigin = requireSameOrigin(request); if (crossOrigin) return crossOrigin;
 * Exempt by design (signed server-to-server): the Paymob and OpenWA webhooks;
 * NextAuth's own /api/auth/[...nextauth] (its CSRF token).
 */
export function requireSameOrigin(request: Request): NextResponse | null {
  return isSameOrigin(request.headers)
    ? null
    : errorResponse(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  fieldErrors?: Record<string, string[]>
) {
  return NextResponse.json(
    { error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } },
    { status }
  );
}
