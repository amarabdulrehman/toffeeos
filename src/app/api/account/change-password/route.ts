import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";
import { hashPassword, verifyPassword } from "@/lib/password";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

// Any signed-in tenant user can change their own password — no permission gate beyond being
// authenticated. Used both for the mustChangePassword forced-first-login flow and as a general
// "change my password" action.
export const POST = defineHandler({ input: schema }, async ({ session, db, input }) => {
  const user = await db.user.findUniqueOrThrow({ where: { id: session.id } });
  if (!user.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new HttpError(400, "Current password is incorrect.");
  }

  const passwordHash = await hashPassword(input.newPassword);
  // Signs out every other device. The caller keeps working: the client refreshes its own token
  // straight after (see the change-password form), which re-stamps it past this watermark.
  await db.user.update({
    where: { id: session.id },
    data: { passwordHash, mustChangePassword: false, sessionsValidFrom: new Date() },
  });

  return { ok: true, sessionsRevoked: true };
});
