import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

const roleRoutes = new Map([
  ["/admin", "ADMIN"],
  ["/teacher", "TEACHER"],
  ["/student", "STUDENT"],
  ["/guardian", "GUARDIAN"],
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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const { locale, rest } = splitLocale(pathname);
  const effectiveLocale = locale ?? routing.defaultLocale;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (rest === "/change-password") {
    if (!token) {
      return NextResponse.redirect(localizedUrl("/login", effectiveLocale, req.nextUrl));
    }
  } else {
    const requiredRole = roleRoutes.get(`/${rest.split("/")[1] ?? ""}`);
    if (requiredRole) {
      if (!token) {
        return NextResponse.redirect(localizedUrl("/login", effectiveLocale, req.nextUrl));
      }
      if (token.role !== requiredRole) {
        const ownDashboard = `/${String(token.role ?? "STUDENT").toLowerCase()}`;
        return NextResponse.redirect(localizedUrl(ownDashboard, effectiveLocale, req.nextUrl));
      }
    }
  }

  return handleI18nRouting(req);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
