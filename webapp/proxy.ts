import { NextResponse, type NextRequest } from "next/server";
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

  return handleI18nRouting(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
