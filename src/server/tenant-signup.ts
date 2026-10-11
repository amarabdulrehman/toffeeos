import "server-only";
import { addDays } from "date-fns";
import { rawDb, platformDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { newId } from "@/lib/ids";
import { hashPassword, generateTempPassword } from "@/lib/password";
import { SEED_ROLES } from "@/server/permissions/registry";
import { defaultModulesForTier, type TierKey } from "@/server/tier";
import { defaultExpenseCategoryRows } from "@/lib/expense-categories";
import { defaultTaxRuleRows } from "@/lib/default-tax-rules";
import { sendEmail } from "@/server/email/adapter";
import { env } from "@/lib/env";
import { BRAND_NAME } from "@/config/brand";

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
  if (existing) throw new HttpError(400, "That restaurant URL is already taken.");

  // Deliberately a plain Error, not an HttpError: this is an operator-facing deployment problem
  // (the plans were never seeded), and the public signup route only forwards HttpError messages to
  // the caller. An anonymous visitor gets the generic failure; the real cause goes to Sentry.
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
        // Tier-preset starting point for the per-tenant feature toggles — freely customizable per
        // module afterward from the super-admin panel; this is just where a new tenant starts.
        enabledModules: defaultModulesForTier(account.planKey),
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
    await tx.taxRule.createMany({ data: defaultTaxRuleRows(tenantId, branchId) });

    /**
     * A stock location, because without one inventory silently does nothing.
     *
     * Recipe depletion runs at payment and resolves a location first
     * (src/server/recipes.ts, resolveConsumptionLocation). With no location it returns null and
     * deductForOrder returns an empty array — no deduction, no error, no log. A new owner could
     * add inventory items, write recipes, sell all week, and find stock had never moved, with
     * nothing anywhere saying why. Low-stock alerts never fire either, for the same reason.
     *
     * Every other day-one default is provisioned here — tax rules, expense categories, roles — and
     * this belongs with them. It is set as the branch's default so the resolver takes the first
     * branch rather than the fallback lookup. Renaming it, or adding more, is ordinary tenant
     * configuration afterward.
     */
    const stockLocation = await tx.stockLocation.create({
      data: { tenantId, branchId, name: "Main Store" },
    });
    await tx.branchSettings.update({
      where: { branchId },
      data: { defaultStockLocationId: stockLocation.id },
    });

    // Expense categories are tenant-wide (not per-branch), so unlike the tax rules above these are
    // seeded once regardless of how many branches the tenant later adds.
    await tx.expenseCategory.createMany({ data: defaultExpenseCategoryRows(tenantId) });

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
 * funnel, not a place to land on a paid tier.
 *
 * One trial per email, enforced here (not in provisionTenant, which adminCreateTenant also calls —
 * a platform admin legitimately may want to onboard the same person across multiple restaurant
 * accounts, so this restriction only applies to the self-serve funnel). Without it, the only
 * uniqueness this flow ever checked was the tenant slug: a script could mint unlimited free trials
 * off the same email under a new slug each time, and since a lapsed trial only ever gets flagged in
 * the admin panel rather than blocked (see getBillingStatus's "flag, don't block" contract), an
 * unrate-limited trial was a genuinely free, self-renewing resource. Checked via platformDb
 * (BYPASSRLS) because this is a cross-tenant lookup by design — rawDb's RLS policy would silently
 * return zero rows for any query issued before app.tenant_id is set, which would make this check
 * pass every time regardless of whether the email is already in use. */
export async function signupTenant(input: SignupInput): Promise<void> {
  // Slug first, and it still reports failure honestly: restaurant URLs are public by definition
  // (they are in every storefront link), so "that URL is taken" leaks nothing. Doing it here rather
  // than inside provisionTenant keeps it ahead of the email branch below, so a taken slug is still
  // a real error even when the email is also in use.
  const existingTenant = await rawDb.tenant.findUnique({ where: { slug: input.slug }, select: { id: true } });
  if (existingTenant) throw new HttpError(400, "That restaurant URL is already taken.");

  // Hashed before the duplicate check, not after, so both outcomes pay the same ~100ms of bcrypt.
  // Short-circuiting first made "email already registered" measurably faster to answer than a real
  // signup, which is an enumeration oracle in its own right — a quieter one than the response body,
  // and one that would have survived fixing the message.
  const passwordHash = await hashPassword(input.ownerPassword);

  const existingUser = await platformDb.user.findFirst({ where: { email: input.ownerEmail }, select: { id: true } });
  if (existingUser) {
    // Tell the account holder, not the person at the keyboard. If this really is them, the email
    // says what to do; if it isn't, it's the only signal that someone is probing their address.
    // Fire-and-forget: awaiting it would put the mail round trip on the duplicate path only,
    // re-introducing the timing difference the hash above exists to remove.
    void sendEmail(
      input.ownerEmail,
      `Someone tried to sign up with your ${BRAND_NAME} email`,
      `Someone just tried to create a new ${BRAND_NAME} restaurant account using this email address.\n\nYou already have an account, so nothing was created. If this was you, sign in at ${env.NEXT_PUBLIC_APP_URL}/login instead.\n\nIf it wasn't you, you can ignore this — but consider changing your password if you reuse it elsewhere.`
    ).catch(() => {});

    // Returns *successfully* without provisioning anything. This is the whole anti-enumeration
    // design: the caller cannot distinguish "email was free, account created" from "email was
    // taken, nothing happened", because both produce an identical response and an identical
    // redirect to the sign-in page. An earlier version threw a generic error here, which still
    // leaked — a request that failed with everything else valid could only mean the email existed.
    //
    // The one trial per email rule is still enforced: no Tenant, Subscription or User is created.
    return;
  }

  await provisionTenant(input, { passwordHash, mustChangePassword: false, planKey: "starter", trial: true });
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
