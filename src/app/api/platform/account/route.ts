import { z } from "zod";
import { emailInput } from "@/lib/identity";
import { definePlatformHandler, HttpError } from "@/server/platform-handler";
import { Prisma } from "@/generated/prisma/client";
import { platformDb } from "@/server/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z
  .object({
    currentPassword: z.string().min(1),
    newEmail: emailInput().optional(),
    newPassword: z.string().min(8, "Password must be at least 8 characters").optional(),
  })
  .refine((v) => v.newEmail || v.newPassword, { message: "Provide a new email and/or a new password." });

// The only self-service way to change the platform admin's own email/password — previously the
// only path was the "forgot password" email-reset flow, which needs a working RESEND_API_KEY and
// isn't the right tool for "I'm logged in and just want to update this." Requires the current
// password, rate-limited the same as MFA enroll/disable — changing account-recovery credentials
// while already authenticated shouldn't have unlimited guesses just because a session is open.
export const POST = definePlatformHandler({ input: schema }, async ({ session, input }) => {
  if (!(await checkRateLimit(`platform-mfa-reauth:${session.id}`, 8, 15 * 60 * 1000))) {
    throw new HttpError(429, "Too many attempts — please wait a while and try again.");
  }

  const platformUser = await platformDb.platformUser.findUniqueOrThrow({ where: { id: session.id } });
  if (!(await verifyPassword(input.currentPassword, platformUser.passwordHash))) {
    throw new HttpError(400, "Current password is incorrect.");
  }

  try {
    await platformDb.platformUser.update({
      where: { id: session.id },
      data: {
        ...(input.newEmail ? { email: input.newEmail } : {}),
        // Changing the password revokes every session for this account, including any still open
        // elsewhere. The UI already signs the caller out afterwards, so there is nothing to refresh
        // here — and this is the single most powerful account in the system (BYPASSRLS across every
        // tenant), so erring toward "sign everything out" is the right trade.
        ...(input.newPassword
          ? { passwordHash: await hashPassword(input.newPassword), sessionsValidFrom: new Date() }
          : {}),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(400, "That email is already in use.");
    }
    throw err;
  }

  // The active session's JWT still carries the old email — force a fresh sign-in rather than
  // leave a stale email cached in the header until the token naturally expires.
  return { ok: true, requiresReauth: true };
});
