import "dotenv/config";
import { Client } from "pg";
import { TIER_ORDER, defaultModulesForTier } from "../src/lib/tiers";

/**
 * One-off maintenance script, run once immediately after the phase5e_feature_toggles migration:
 * Subscription.enabledModules is a new column with @default([]), so every existing subscription
 * landed on it empty — which would strip every current tenant's tier-entitled features (Inventory,
 * CRM, etc.) the instant enforcement switched from reading `plan.key` to reading this column. This
 * backfills each existing subscription to its own tier's default set, i.e. exactly what it already
 * had access to before this change — a preset seed, not a behavior change. Safe to re-run; it only
 * ever sets rows to their tier's current default (fine to re-apply after later default changes too,
 * though any admin's manual per-tenant customization would be overwritten by a re-run — this is
 * meant as a one-time migration step, not a scheduled job).
 */
async function main() {
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();

  for (const tier of TIER_ORDER) {
    const modules = defaultModulesForTier(tier);
    const res = await client.query(
      `UPDATE "Subscription" s SET "enabledModules" = $1
       FROM "Plan" p WHERE s."planId" = p.id AND p.key = $2`,
      [modules, tier]
    );
    console.log(`${tier}: backfilled ${res.rowCount} subscription row(s) to [${modules.join(", ") || "none"}]`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
