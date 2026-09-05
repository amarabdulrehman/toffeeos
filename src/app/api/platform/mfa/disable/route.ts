import { z } from "zod";
import { definePlatformHandler, HttpError } from "@/server/platform-handler";
import { platformDb } from "@/server/db";
import { verifyPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";
import { disableTotp } from "@/server/platform-mfa";

const schema = z.object({ password: z.string().min(1) });

// Requires re-entering the current password — disabling 2FA is significant enough that a
// left-open browser session shouldn't be able to do it with a single click. Also rate-limited:
// a valid session alone (a stolen cookie, an unlocked laptop) shouldn't get unlimited password
// guesses just because it bypasses the login form.
export const POST = definePlatformHandler({ input: schema }, async ({ session, input }) => {
  if (!(await checkRateLimit(`platform-mfa-reauth:${session.id}`, 8, 15 * 60 * 1000))) {
    throw new HttpError(429, "Too many attempts — please wait a while and try again.");
  }
  const platformUser = await platformDb.platformUser.findUniqueOrThrow({ where: { id: session.id } });
  if (!(await verifyPassword(input.password, platformUser.passwordHash))) {
    throw new HttpError(400, "Incorrect password.");
  }
  await disableTotp(session.id);
  return { ok: true };
});
