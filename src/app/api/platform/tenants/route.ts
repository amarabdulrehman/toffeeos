import { z } from "zod";
import { definePlatformHandler, platformDb, HttpError } from "@/server/platform-handler";
import { adminCreateTenant } from "@/server/tenant-signup";
import { TIER_ORDER } from "@/server/tier";

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
      planKey: t.subscription?.plan.key ?? null,
      subscriptionStatus: t.subscription?.status ?? null,
      trialEndsAt: t.subscription?.trialEndsAt ?? null,
    })),
  };
});

const createSchema = z.object({
  restaurantName: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  ownerName: z.string().min(2).max(120),
  ownerEmail: z.string().email(),
  branchName: z.string().min(2).max(120),
  city: z.string().max(120).optional(),
  planKey: z.enum(TIER_ORDER),
});

// POST /api/platform/tenants — the only admin-side way to provision a brand-new tenant. Generates
// a random temp password rather than accepting one (there's no legitimate reason a platform admin
// should be choosing a customer's password) and returns it in this one response only; the owner
// account is flagged mustChangePassword so the first login has to replace it before reaching the app.
export const POST = definePlatformHandler({ input: createSchema }, async ({ input }) => {
  try {
    return await adminCreateTenant(input);
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : "Could not create tenant.");
  }
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
