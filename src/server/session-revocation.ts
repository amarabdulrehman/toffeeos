"use server";

import { auth } from "@/server/auth";
import { platformDb, runInTenantTransaction } from "@/server/db";

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
  // A platform admin signing out of someone's account they were looking into ends their own visit,
  // not the staff member's real sessions on the till.
  if (user.impersonatedByPlatformUserId) return;

  // With the restaurant set on the connection. This used rawDb, as the app's own database role with
  // no restaurant set, and row-level security on "User" (tenant_isolation, FORCE) hides every row
  // from that: the update matched nothing and threw "No record was found for an update" on every
  // sign-out since September, which the button swallowed. Suspension doesn't come into it — the
  // policy only compares the row's restaurant with the connection's.
  await runInTenantTransaction(user.tenantId, (tx) =>
    tx.user.update({ where: { id: user.id }, data: { sessionsValidFrom: now } })
  );
}
