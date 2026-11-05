import { NextResponse, type NextRequest } from "next/server";

/**
 * First line of defence only: redirects requests that have no session cookie at all.
 * Real authentication and role checks happen server-side (requireRole) on every
 * protected page, layout and action, because a cookie's presence proves nothing.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasCookie = req.cookies.has("pnpay_session");
  if (!hasCookie) {
    if (pathname.startsWith("/student")) return NextResponse.redirect(new URL("/login", req.url));
    if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
      return NextResponse.redirect(new URL("/admin/login", req.url));
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/student/:path*", "/admin/:path*"] };
