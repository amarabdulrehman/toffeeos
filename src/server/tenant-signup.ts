import "server-only";
import { addDays } from "date-fns";
import { rawDb } from "@/server/db";
import { newId } from "@/lib/ids";
import { hashPassword } from "@/lib/password";
import { SEED_ROLES } from "@/server/permissions/registry";

export interface SignupInput {
  restaurantName: string;
  slug: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  branchName: string;
  city?: string;
}

const TRIAL_DAYS = 14;

/**
 * The one legitimate place application code creates a Tenant row directly: there is no tenantId
 * to scope by yet, because we're creating it. Runs as a single hand-written transaction (not
 * runInTenantTransaction, which requires an existing tenantId) — sets app.tenant_id to the
 * newly-minted id as soon as the Tenant row exists, then every subsequent create in this same
 * transaction is explicit about tenantId (no auto-injection available inside an interactive
 * transaction — see the comment on runInTenantTransaction in src/server/db.ts).
 *
 * Creates: Tenant, Subscription (14-day trial on the Starter plan), first Branch + its settings,
 * the seeded Punjab PRA split-rate tax rules, the 6 standard roles, and the owner User + Membership.
 */
export async function signupTenant(input: SignupInput): Promise<{ tenantId: string; slug: string }> {
  const existing = await rawDb.tenant.findUnique({ where: { slug: input.slug } });
  if (existing) throw new Error("That restaurant URL is already taken.");

  const starterPlan = await rawDb.plan.findUnique({ where: { key: "starter" } });
  if (!starterPlan) throw new Error("Starter plan is not seeded — run `npm run seed` first.");

  const passwordHash = await hashPassword(input.ownerPassword);
  const tenantId = newId();
  const branchId = newId();
  const ownerId = newId();

  await rawDb.$transaction(async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, name: input.restaurantName, slug: input.slug, status: "TRIALING" },
    });

    // Now that the Tenant row exists, every subsequent statement in this transaction runs under
    // its RLS scope too.
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.subscription.create({
      data: {
        tenantId,
        planId: starterPlan.id,
        status: "TRIALING",
        branchLimit: starterPlan.maxBranches,
        trialEndsAt: addDays(new Date(), TRIAL_DAYS),
      },
    });

    await tx.branch.create({
      data: { id: branchId, tenantId, name: input.branchName, address: input.city },
    });

    await tx.branchSettings.create({
      data: { tenantId, branchId, serviceChargeBasisPoints: 0, roundingMode: "NEAREST_1" },
    });

    // Punjab PRA split-rate seed (16% cash / 5% card & digital) — see the plan doc's tax decision.
    // Fully editable per-branch afterward in Settings; this is just the day-one default.
    await tx.taxRule.createMany({
      data: [
        { tenantId, branchId, name: "Cash (PRA)", paymentMethods: ["CASH"], rateBasisPoints: 1600 },
        {
          tenantId,
          branchId,
          name: "Card & digital (PRA)",
          paymentMethods: ["CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER"],
          rateBasisPoints: 500,
        },
      ],
    });

    for (const [key, def] of Object.entries(SEED_ROLES)) {
      await tx.role.create({
        data: { tenantId, key, name: def.name, permissions: def.permissions, isSystem: true },
      });
    }

    const ownerRole = await tx.role.findFirstOrThrow({ where: { tenantId, key: "owner" } });

    await tx.user.create({
      data: {
        id: ownerId,
        tenantId,
        name: input.ownerName,
        email: input.ownerEmail,
        passwordHash,
        isActive: true,
      },
    });

    await tx.membership.create({
      data: { tenantId, userId: ownerId, branchId, roleId: ownerRole.id, isActive: true },
    });
  });

  return { tenantId, slug: input.slug };
}
