import "dotenv/config";
import { Client } from "pg";
import { SEED_ROLES } from "../src/server/permissions/registry";

/**
 * One-off maintenance script: re-syncs every isSystem role's `permissions` array to match the
 * current SEED_ROLES definition in the registry. Needed because Role.permissions is a snapshot
 * copied at signup/seed time, not computed live from the registry — so adding a new permission key
 * (as Phase 2 just did: inventory.location.manage, inventory.item.manage) doesn't retroactively
 * reach existing tenants' system roles. Safe to re-run any time after adding permission keys;
 * never touches isSystem=false (owner-customized) roles.
 */
async function main() {
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();

  for (const [key, def] of Object.entries(SEED_ROLES)) {
    const res = await client.query(
      `UPDATE "Role" SET permissions = $1 WHERE key = $2 AND "isSystem" = true RETURNING "tenantId"`,
      [def.permissions, key]
    );
    console.log(`${key}: updated ${res.rowCount} role row(s)`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
