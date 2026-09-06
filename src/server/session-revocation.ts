"use server";

import { auth } from "@/server/auth";
import { rawDb, platformDb } from "@/server/db";

/**
 * Server-side session revocation for a stateless (JWT) auth setup.
 *
 * NextAuth's `signOut()` only deletes the cookie in the browser. The JWT it held stays
 * cryptographically valid until it expires, so anything that already has a copy — a cookie lifted
 * off a shared POS terminal, a session still open on a phone left at home, a token captured from a
 * logged response — keeps full access regardless of the user "signing out".
 *
 * There is no server-side session row to delete, so revocation is done with a watermark instead:
 * bumping `sessionsValidFrom` to now invalidates every token issued before this instant. Every
 * request compares its stamp against the stored value (see defineHandler / definePlatformHandler),
 * so revocation takes effect on the very next call rather than whenever the token happens to lapse.
 *
 * Deliberately revokes *all* of the account's sessions, not just the current device. For a
 * restaurant POS shared between shifts that is the safer default: someone signing out at the end of
 * a shift means "I'm done", and quietly leaving other copies alive is exactly the failure mode this
 * is here to close. A per-device variant would need a device id in the token, which is a bigger
 * change than this problem warrants.
 */
export async function revokeMySessions(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (!user) return;

  const now = new Date();
  if (user.kind === "platform") {
    await platformDb.platformUser.update({ where: { id: user.id }, data: { sessionsValidFrom: now } });
    return;
  }
  // rawDb, not tenantDb: this is a write to the caller's own row keyed by primary key, and it must
  // still succeed for a user whose tenant has since been suspended — they should be able to sign
  // out of an account they can no longer otherwise use.
  await rawDb.user.update({ where: { id: user.id }, data: { sessionsValidFrom: now } });
}
