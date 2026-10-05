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
