import type { NextAuthConfig } from "next-auth";
import type { SessionUser } from "./types";

/**
 * The edge-safe half of the Auth.js config: no providers, no Prisma import, nothing that touches
 * Node-only APIs. This is what src/middleware.ts uses to decide "is there a valid session and
 * does it match the route group" — middleware runs on the Edge runtime, which cannot load Prisma.
 *
 * src/server/auth/config.ts spreads this and adds the real (Node-only) providers for the actual
 * sign-in route handler. Keep any callback here in sync with anything the middleware needs to
 * read off the token — jwt/session shaping specifically, since those run in both places.
 */
export const edgeAuthConfig = {
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    async session({ session, token }) {
      // NextAuth's own Session.user augmentation (for the database-session/adapter case) merges
      // with ours into `AdapterUser & SessionUser`, which our JWT-strategy sessions never satisfy
      // (there is no adapter, no emailVerified, etc.) — the runtime shape is correct, so write
      // through a loosely-typed alias rather than fighting NextAuth's typing here.
      const loose = session as unknown as { user?: SessionUser };
      if (token.user) loose.user = token.user as unknown as SessionUser;
      return session;
    },
  },
} satisfies NextAuthConfig;
