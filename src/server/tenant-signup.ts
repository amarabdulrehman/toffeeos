import "server-only";
import { addDays } from "date-fns";
import { rawDb } from "@/server/db";
import { newId } from "@/lib/ids";
import { hashPassword, generateTempPassword } from "@/lib/password";
import { SEED_ROLES } from "@/server/permissions/registry";
import type { TierKey } from "@/server/tier";

export interface ProvisionTenantInput {
  restaurantName: string;
  slug: string;
  ownerName: string;
  ownerEmail: string;
  branchName: string;
  city?: string;
}

export interface SignupInput extends ProvisionTenantInput {
  ownerPassword: string;
}

const TRIAL_DAYS = 14;

interface ProvisionAccount {
  passwordHash: string;
  mustChangePassword: boolean;
  planKey: TierKey;
  /** Self-serve signup always starts a trial; admin-provisioned tenants start ACTIVE on their
   * chosen paid tier instead, since a platform admin picking a tier is "onboarding a client
   * directly onto a paid plan" (their words), not starting a free trial. */
  trial: boolean;
}

/**
 * The one legitimate place application code creates a Tenant row directly: there is no tenantId
 * to scope by yet, because we're creating it. Runs as a single hand-written transaction (not
 * runInTenantTransaction, which requires an existing tenantId) — sets app.tenant_id to the
 * newly-minted id as soon as the Tenant row exists, then every subsequent create in this same
 * transaction is explicit about tenantId (no auto-injection available inside an interactive
 * transaction — see the comment on runInTenantTransaction in src/server/db.ts).
 *
 * Creates: Tenant, Subscription (on the chosen plan), first Branch + its settings, the seeded
 * Punjab PRA split-rate tax rules, the 6 standard roles, and the owner User + Membership. Shared
 * by both `signupTenant` (public self-serve, owner picks their own password, always Starter/trial)
 * and `adminCreateTenant` (platform-admin-only, temp password + a chosen tier, always ACTIVE).
 */
async function provisionTenant(
  input: ProvisionTenantInput,
  account: ProvisionAccount
): Promise<{ tenantId: string; slug: string }> {
  const existing = await rawDb.tenant.findUnique({ where: { slug: input.slug } });
  if (existing) throw new Error("That restaurant URL is already taken.");

  const plan = await rawDb.plan.findUnique({ where: { key: account.planKey } });
  if (!plan) throw new Error(`The ${account.planKey} plan is not seeded — run \`npm run seed\` first.`);

  const tenantId = newId();
  const branchId = newId();
  const ownerId = newId();

  await rawDb.$transaction(async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, name: input.restaurantName, slug: input.slug, status: account.trial ? "TRIALING" : "ACTIVE" },
    });

    // Now that the Tenant row exists, every subsequent statement in this transaction runs under
    // its RLS scope too.
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.subscription.create({
      data: {
        tenantId,
        planId: plan.id,
        status: account.trial ? "TRIALING" : "ACTIVE",
        branchLimit: plan.maxBranches,
        trialEndsAt: account.trial ? addDays(new Date(), TRIAL_DAYS) : null,
      },
    });

    await tx.branch.create({
      data: { id: branchId, tenantId, name: input.branchName, address: input.city },
    });

    await tx.branchSettings.create({
      data: { tenantId, branchId, serviceChargeBasisPoints: 0, roundingMode: "NEAREST_1" },
    });

    // Punjab PRA split-rate seed (16% cash / 8% card & digital) — see the plan doc's tax decision.
    // Fully editable per-branch afterward in Settings; this is just the day-one default.
    await tx.taxRule.createMany({
      data: [
        { tenantId, branchId, name: "Cash (PRA)", paymentMethods: ["CASH"], rateBasisPoints: 1600 },
        {
          tenantId,
          branchId,
          name: "Card & digital (PRA)",
          paymentMethods: ["CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER"],
          rateBasisPoints: 800,
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
        passwordHash: account.passwordHash,
        isActive: true,
        mustChangePassword: account.mustChangePassword,
      },
    });

    await tx.membership.create({
      data: { tenantId, userId: ownerId, branchId, roleId: ownerRole.id, isActive: true },
    });
  });

  return { tenantId, slug: input.slug };
}

/** Public, unauthenticated self-serve trial signup — the owner picks their own password, so there's
 * nothing to force-change on first login. Always Starter/trial, by design — this is the trial
 * funnel, not a place to land on a paid tier. */
export async function signupTenant(input: SignupInput): Promise<{ tenantId: string; slug: string }> {
  const passwordHash = await hashPassword(input.ownerPassword);
  return provisionTenant(input, { passwordHash, mustChangePassword: false, planKey: "starter", trial: true });
}

/** Platform-admin-only tenant provisioning: generates a random temp password instead of asking the
 * operator to invent one, and flags the owner account so the very first login must replace it
 * before anything else in the app is reachable (see the mustChangePassword gate in the app/pos/kds
 * layouts). The plaintext temp password is returned exactly once here — the caller (the platform
 * tenants API route) must hand it to the admin and never persist it. Lands ACTIVE on whichever tier
 * the admin picked, not TRIALING — an admin choosing a tier is onboarding a real client, not
 * starting a free trial. */
export async function adminCreateTenant(
  input: ProvisionTenantInput & { planKey: TierKey }
): Promise<{ tenantId: string; slug: string; tempPassword: string }> {
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const result = await provisionTenant(input, {
    passwordHash,
    mustChangePassword: true,
    planKey: input.planKey,
    trial: false,
  });
  return { ...result, tempPassword };
}
