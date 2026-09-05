import { definePlatformHandler } from "@/server/platform-handler";
import { platformDb } from "@/server/db";

export const GET = definePlatformHandler({}, async ({ session }) => {
  const platformUser = await platformDb.platformUser.findUniqueOrThrow({
    where: { id: session.id },
    select: { totpEnabled: true },
  });
  return { totpEnabled: platformUser.totpEnabled };
});
