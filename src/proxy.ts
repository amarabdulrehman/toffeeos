import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { edgeAuthConfig } from "@/server/auth/edge-config";

// Edge runtime: uses the Prisma-free half of the auth config (see edge-config.ts) to decode the
// JWT and read session.user.kind — it never touches the database.
const { auth } = NextAuth(edgeAuthConfig);

const PLATFORM_LOGIN = "/platform/login";
const TENANT_LOGIN = "/login";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;

  const isPlatformRoute = pathname.startsWith("/platform") && pathname !== PLATFORM_LOGIN;
  const isTenantAppRoute =
    (pathname.startsWith("/app") || pathname.startsWith("/pos") || pathname.startsWith("/kds")) &&
    pathname !== TENANT_LOGIN;

  if (isPlatformRoute) {
    if (!user || user.kind !== "platform") {
      return NextResponse.redirect(new URL(PLATFORM_LOGIN, req.url));
    }
  }

  if (isTenantAppRoute) {
    if (!user || user.kind !== "tenant") {
      const loginUrl = new URL(TENANT_LOGIN, req.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/app/:path*", "/pos/:path*", "/kds/:path*", "/platform/:path*"],
};
