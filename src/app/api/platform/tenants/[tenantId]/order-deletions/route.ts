import { definePlatformHandler, platformDb } from "@/server/platform-handler";

// GET /api/platform/tenants/[tenantId]/order-deletions — the same log, from the platform side. The
// point of a second reader: the person who deletes orders is not the only one who can see that
// they did.
export const GET = definePlatformHandler({}, async ({ params }) => {
  const deletions = await platformDb.orderDeletion.findMany({
    where: { tenantId: params.tenantId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return { deletions };
});
