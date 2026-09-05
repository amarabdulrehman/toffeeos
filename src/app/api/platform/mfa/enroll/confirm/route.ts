import { z } from "zod";
import { definePlatformHandler, HttpError } from "@/server/platform-handler";
import { platformDb } from "@/server/db";
import { verifyPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyAndEnableTotp } from "@/server/platform-mfa";

const schema = z.object({ password: z.string().min(1), secret: z.string().min(1), code: z.string().min(1) });

// Requires the current password, not just a valid session — otherwise a hijacked session (stolen
// cookie, XSS) could silently enroll an attacker-controlled authenticator, turning a temporary
// session compromise into a standing lockout of the real owner. Same reasoning as /mfa/disable,
// including the rate limit on the password re-check itself.
export const POST = definePlatformHandler({ input: schema }, async ({ session, input }) => {
  if (!(await checkRateLimit(`platform-mfa-reauth:${session.id}`, 8, 15 * 60 * 1000))) {
    throw new HttpError(429, "Too many attempts — please wait a while and try again.");
  }
  const platformUser = await platformDb.platformUser.findUniqueOrThrow({ where: { id: session.id } });
  if (!(await verifyPassword(input.password, platformUser.passwordHash))) {
    throw new HttpError(400, "Incorrect password.");
  }
  return verifyAndEnableTotp(session.id, session.email, input.secret, input.code);
});
