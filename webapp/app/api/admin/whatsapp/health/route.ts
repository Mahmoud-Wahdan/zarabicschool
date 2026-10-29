import { NextResponse } from "next/server";

import { requireApiRole } from "../../../../../lib/dal";

/**
 * GET /api/admin/whatsapp/health — ADMIN only (Supervisor 403).
 * Server-side probe of OpenWA `GET /health` (liveness) and `GET /health/ready`
 * (dependencies). The API key never leaves the server and is never logged; the
 * response carries only reachability, HTTP status and the reported status word.
 */
const PROBE_TIMEOUT_MS = 5000;

async function probe(url: string, apiKey: string) {
  try {
    const response = await fetch(url, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
    return {
      reachable: true,
      httpStatus: response.status,
      status: typeof body?.status === "string" ? body.status.slice(0, 32) : null,
    };
  } catch {
    return { reachable: false, httpStatus: null, status: null };
  }
}

export async function GET() {
  const { error } = await requireApiRole("ADMIN");
  if (error) return error;

  const baseUrl = process.env.OPENWA_URL;
  const apiKey = process.env.OPENWA_API_KEY;
  const configured = Boolean(baseUrl && apiKey && process.env.OPENWA_SESSION_ID);
  if (!baseUrl || !apiKey) {
    return NextResponse.json({ data: { configured: false, health: null, ready: null } });
  }
  const root = `${baseUrl.replace(/\/$/, "")}/api`;
  const [health, ready] = await Promise.all([probe(`${root}/health`, apiKey), probe(`${root}/health/ready`, apiKey)]);
  return NextResponse.json({ data: { configured, health, ready } });
}
