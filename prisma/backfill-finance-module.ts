import "dotenv/config";
import { Client } from "pg";
import { DEFAULT_EXPENSE_CATEGORIES } from "../src/lib/expense-categories";

/**
 * One-off maintenance script for the Phase 8 expense feature: Subscription.enabledModules is the
 * live source of truth for what a tenant can access, and adding "finance" to GATEABLE_MODULES only
 * changes what NEW tenants get (via defaultModulesForTier at signup). Existing subscriptions keep
 * whatever array they already have, so without this they'd never see the feature at all.
 *
 * Deliberately NOT written as "reset each tenant to its tier's defaults" the way
 * backfill-feature-toggles.ts does — that script REPLACES the whole array, and its own doc comment
 * warns it clobbers per-tenant customization. That's not hypothetical here: the demo tenant is on
 * the growth plan but has delivery/online/whatsapp/hr custom-enabled by a platform admin, and a
 * replace-style backfill would silently strip all four. This one only ever appends the single new
 * key, to tenants whose tier already entitles them to it, and is a no-op on re-run.
 */
async function main() {
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();

  const res = await client.query(
    `UPDATE "Subscription" s
        SET "enabledModules" = array_append(s."enabledModules", 'finance')
       FROM "Plan" p
      WHERE s."planId" = p.id
        AND p.key IN ('growth', 'complete')
        AND NOT ('finance' = ANY(s."enabledModules"))`
  );
  console.log(`Appended "finance" to ${res.rowCount} subscription row(s) on growth/complete plans.`);

  const remaining = await client.query(
    `SELECT count(*)::int AS n
       FROM "Subscription" s JOIN "Plan" p ON s."planId" = p.id
      WHERE p.key IN ('growth', 'complete') AND NOT ('finance' = ANY(s."enabledModules"))`
  );
  console.log(`Entitled subscriptions still missing "finance": ${remaining.rows[0].n} (expected 0).`);

  // Default categories only reach NEW tenants (provisionTenant / seed.ts). Existing tenants would
  // otherwise open the feature to an empty category dropdown and be unable to record anything, since
  // createExpense requires a real category. Seeded only for tenants that have none at all, so a
  // tenant who already curated their own list — or archived defaults they didn't want — never has
  // them reappear on a re-run.
  const tenants = await client.query<{ id: string }>(
    `SELECT t.id FROM "Tenant" t
      WHERE NOT EXISTS (SELECT 1 FROM "ExpenseCategory" c WHERE c."tenantId" = t.id)`
  );

  for (const { id } of tenants.rows) {
    await client.query(
      `INSERT INTO "ExpenseCategory" ("id", "tenantId", "name", "sortOrder")
       SELECT gen_random_uuid(), $1, name, ordinality - 1
         FROM unnest($2::text[]) WITH ORDINALITY AS t(name, ordinality)`,
      [id, [...DEFAULT_EXPENSE_CATEGORIES]]
    );
  }
  console.log(`Seeded default expense categories for ${tenants.rows.length} tenant(s) that had none.`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
