import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";
import { allowRequest } from "./lib/rate-limit";
import { getClientIp } from "./lib/request";

const handleI18nRouting = createMiddleware(routing);

const roleRoutes = new Map<string, string[]>([
  ["/admin", ["ADMIN"]],
  ["/supervisor", ["SUPERVISOR"]],
  ["/teacher", ["TEACHER"]],
  ["/student", ["STUDENT"]],
  ["/guardian", ["GUARDIAN"]],
]);

function splitLocale(pathname: string) {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return { locale, rest: "/" };
    if (pathname.startsWith(`/${locale}/`)) {
      return { locale, rest: pathname.slice(locale.length + 1) };
    }
  }
  return { locale: null, rest: pathname };
}

function localizedUrl(path: string, locale: string, base: URL) {
  return new URL(`/${locale}${path === "/" ? "" : path}`, base);
}

/**
 * Content-Security-Policy for pages (G-A02-1, 2026-10-29), the Next.js nonce pattern
 * (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md): a fresh
 * nonce per request, which Next.js puts on its own scripts, so no inline or injected
 * script runs without it. Styles keep 'unsafe-inline' (React style attributes; a nonce
 * there would switch it off). CSP_REPORT_ONLY=1 sends it as Report-Only instead.
 */
function contentSecurityPolicy(nonce: string) {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function cspHeaderName() {
  return process.env.CSP_REPORT_ONLY === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}

/** Router prefetches fetch RSC data the browser never renders as a document. */
function isPrefetch(req: NextRequest) {
  return req.headers.has("next-router-prefetch") || req.headers.get("purpose") === "prefetch";
}

/** Locale routing with the CSP on the request (Next.js reads the nonce there) and on the response. */
function routeWithCsp(req: NextRequest) {
  // next-intl answers a path that is not valid percent-encoding with a bare
  // NextResponse.next() that drops our request headers, so the page would render
  // without the nonce under a policy that requires it. Refuse such paths here.
  try {
    decodeURI(req.nextUrl.pathname);
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }
  if (isPrefetch(req)) return handleI18nRouting(req);
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce);
  const header = cspHeaderName();
  const headers = new Headers(req.headers);
  headers.set(header, policy);
  const response = handleI18nRouting(new NextRequest(req, { headers }));
  response.headers.set(header, policy);
  return response;
}

function rolesForRoute(rest: string): string[] | undefined {
  if (rest === "/admin/applications" || rest.startsWith("/admin/applications/")) {
    return ["ADMIN"];
  }
  if (
    rest === "/admin/students" || rest.startsWith("/admin/students/") ||
    rest === "/admin/guardians" || rest.startsWith("/admin/guardians/") ||
    rest === "/admin/teachers" || rest.startsWith("/admin/teachers/") ||
    rest === "/admin/subjects" || rest.startsWith("/admin/subjects/")
    || rest === "/admin/assignments" || rest.startsWith("/admin/assignments/")
    || rest === "/admin/enrollments" || rest.startsWith("/admin/enrollments/")
    || rest === "/admin/sessions" || rest.startsWith("/admin/sessions/")
    // Phase 7 (owner, 2026-10-26): complaints, evaluation summaries and
    // announcements are handled by Admin AND Supervisor (pages re-check the role).
    || rest === "/admin/complaints" || rest.startsWith("/admin/complaints/")
    || rest === "/admin/evaluations" || rest.startsWith("/admin/evaluations/")
    || rest === "/admin/announcements" || rest.startsWith("/admin/announcements/")
  ) {
    return ["ADMIN", "SUPERVISOR"];
  }
  return roleRoutes.get(`/${rest.split("/")[1] ?? ""}`);
}

export async function proxy(req: NextRequest) {
  const clientIp = getClientIp(req.headers);
  if (!allowRequest(`request:${clientIp}`, 120, 60 * 1000)) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } },
      { status: 429 },
    );
  }

  const { pathname } = req.nextUrl;
  const { locale, rest } = splitLocale(pathname);
  const effectiveLocale = locale ?? routing.defaultLocale;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (rest === "/change-password") {
    if (!token) {
      return NextResponse.redirect(localizedUrl("/login", effectiveLocale, req.nextUrl));
    }
  } else {
    if (token?.mustChangePassword) {
      return NextResponse.redirect(localizedUrl("/change-password", effectiveLocale, req.nextUrl));
    }
    const allowedRoles = rolesForRoute(rest);
    if (allowedRoles) {
      if (!token) {
        return NextResponse.redirect(localizedUrl("/login", effectiveLocale, req.nextUrl));
      }
      if (!allowedRoles.includes(String(token.role))) {
        const ownDashboard = `/${String(token.role ?? "STUDENT").toLowerCase()}`;
        return NextResponse.redirect(localizedUrl(ownDashboard, effectiveLocale, req.nextUrl));
      }
    }
  }

  return routeWithCsp(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
