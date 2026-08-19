import { z } from "zod";
import { definePlatformHandler, platformDb } from "@/server/platform-handler";

// GET /api/platform/tenants — every tenant, for the super-admin panel. Uses platformDb
// (BYPASSRLS), never tenantDb — this route intentionally sees across all tenants.
export const GET = definePlatformHandler({}, async () => {
  const tenants = await platformDb.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      subscription: { include: { plan: true } },
      branches: { select: { id: true } },
      _count: { select: { users: true } },
    },
  });

  return {
    tenants: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      createdAt: t.createdAt,
      branchCount: t.branches.length,
      userCount: t._count.users,
      plan: t.subscription?.plan.name ?? null,
      subscriptionStatus: t.subscription?.status ?? null,
      trialEndsAt: t.subscription?.trialEndsAt ?? null,
    })),
  };
});

const patchSchema = z.object({
  tenantId: z.string().min(1),
  status: z.enum(["TRIALING", "ACTIVE", "SUSPENDED", "CANCELLED"]),
});

// PATCH /api/platform/tenants — suspend/reactivate a tenant, or manually change its lifecycle status.
export const PATCH = definePlatformHandler({ input: patchSchema }, async ({ input }) => {
  const tenant = await platformDb.tenant.update({
    where: { id: input.tenantId },
    data: { status: input.status },
  });
  return { tenant };
});
