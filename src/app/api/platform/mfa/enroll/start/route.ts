import { definePlatformHandler } from "@/server/platform-handler";
import { startTotpEnrollment } from "@/server/platform-mfa";

export const POST = definePlatformHandler({}, async ({ session }) => {
  return startTotpEnrollment(session.email);
});
