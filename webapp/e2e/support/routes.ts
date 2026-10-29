import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type AppRole = "ADMIN" | "SUPERVISOR" | "TEACHER" | "STUDENT" | "GUARDIAN";
export type Handler = { route: string; url: string; method: Method; roles: AppRole[] | null; source: string };

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

/**
 * Every API handler under app/api, read from the source at test time, with the role
 * list its own guard names (requireApiRole/requireApiRoles inside that handler), so
 * a new route is swept without editing this file. Dynamic segments get a random id.
 */
export function apiHandlers(): Handler[] {
  const handlers: Handler[] = [];
  for (const file of routeFiles(join("app", "api"))) {
    const route = "/" + relative("app", file).split(sep).slice(0, -1).join("/");
    if (route.includes("[...")) continue; // NextAuth's own handler
    const url = route.replace(/\[[^\]]+\]/g, () => randomUUID());
    const source = readFileSync(file, "utf8");
    const parts = source.split(/export\s+(?:async\s+)?function\s+/).slice(1);
    for (const part of parts) {
      const method = part.match(/^(GET|POST|PATCH|PUT|DELETE)\b/)?.[1] as Method | undefined;
      if (!method) continue;
      const single = part.match(/requireApiRole\(\s*"([A-Z]+)"/);
      const many = part.match(/requireApiRoles\(\s*\[([^\]]*)\]/);
      const roles = single
        ? [single[1] as AppRole]
        : many
          ? (many[1].match(/"([A-Z]+)"/g) ?? []).map((role) => role.replaceAll('"', "") as AppRole)
          : null;
      handlers.push({ route, url, method, roles, source: part });
    }
  }
  return handlers;
}

/** Signed server-to-server callbacks: no session, no Origin; trust comes from the HMAC. */
export const SIGNED_WEBHOOKS = ["/api/payments/paymob/webhook", "/api/payments/paymob/subscription-webhook", "/api/whatsapp/status"];
