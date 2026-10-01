import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const roleRoutes = new Map([
  ["/admin", "ADMIN"],
  ["/teacher", "TEACHER"],
  ["/student", "STUDENT"],
  ["/guardian", "GUARDIAN"],
]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (pathname === "/change-password") {
    if (!token) return NextResponse.redirect(new URL("/login", req.nextUrl));
    return NextResponse.next();
  }

  const requiredRole = roleRoutes.get(`/${pathname.split("/")[1]}`);
  if (requiredRole) {
    if (!token) return NextResponse.redirect(new URL("/login", req.nextUrl));
    if (token.role !== requiredRole) {
      const ownDashboard = `/${String(token.role ?? "STUDENT").toLowerCase()}`;
      return NextResponse.redirect(new URL(ownDashboard, req.nextUrl));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
