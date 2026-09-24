import { z } from "zod";
import { emailInput } from "@/lib/identity";
import { definePlatformHandler, platformDb, HttpError } from "@/server/platform-handler";
import { adminCreateTenant } from "@/server/tenant-signup";
import { TIER_ORDER } from "@/server/tier";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// GET /api/platform/tenants — paginated, for the super-admin panel. Uses platformDb (BYPASSRLS),
// never tenantDb — this route intentionally sees across all tenants. Unbounded before this (fine
// at a handful of tenants, would only get worse as the platform grows) — page/pageSize query
// params, capped at 100/page, with `total` returned so the UI can render real page controls.
export const GET = definePlatformHandler({ input: listSchema }, async ({ input }) => {
  const [tenants, total] = await Promise.all([
    platformDb.tenant.findMany({
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        subscription: { include: { plan: true } },
        branches: { select: { id: true, isActive: true } },
        _count: { select: { users: true } },
      },
    }),
    platformDb.tenant.count(),
  ]);

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
      currentPeriodEnd: t.subscription?.currentPeriodEnd ?? null,
      customMonthlyPricePaisa: t.subscription?.customMonthlyPricePaisa ?? null,
      // Both halves of the monthly-fee sum, so the list can show each tenant's actual rate without
      // a second request. Active branches only, matching how platformMetrics computes MRR — an
      // inactive branch is not billed, so counting it here would disagree with the MRR headline
      // sitting directly above the table.
      activeBranchCount: t.branches.filter((b) => b.isActive).length,
      pricePaisaPerBranchMonth: t.subscription?.plan.pricePaisaPerBranchMonth ?? null,
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
});

const createSchema = z.object({
  restaurantName: z.string().min(2).max(120),
  // Lowercased before the pattern check, so "Karachi-Karahi" becomes a valid code instead of an error.
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  ownerName: z.string().min(2).max(120),
  ownerEmail: emailInput(),
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
// Audit-logged like every other platform mutation — this became the actual enforcement half of the
// billing loop (recording a payment reactivates automatically; suspending is the one manual override
// that actually blocks access), so "who suspended this tenant, and when" has to be answerable too.
export const PATCH = definePlatformHandler({ input: patchSchema }, async ({ session, input }) => {
  const before = await platformDb.tenant.findUnique({ where: { id: input.tenantId }, select: { status: true } });
  if (!before) throw new HttpError(404, "Tenant not found.");

  const tenant = await platformDb.tenant.update({
    where: { id: input.tenantId },
    data: { status: input.status },
  });

  if (before.status !== input.status) {
    await platformDb.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorId: session.id,
        action: "platform.tenant.status.change",
        entityType: "Tenant",
        entityId: input.tenantId,
        metadata: { platformUserEmail: session.email, from: before.status, to: input.status },
      },
    });
  }

  return { tenant };
});
