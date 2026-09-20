import "dotenv/config";
import { runDatabaseBackup } from "../src/server/backup";

/**
 * Takes a backup now, instead of waiting for 03:30 UTC.
 *
 * Two reasons this needs to exist. The obvious one is before anything risky — a migration you are
 * unsure about, a bulk edit, a restore. The less obvious one is that it makes rehearsing a restore
 * safe: take a backup of the current state, restore that same file, and a working restore leaves
 * the database exactly where it started. Without this the newest archive might be days old, and
 * "rehearsing" would mean throwing away everything since.
 *
 * Writes to whatever NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY point at, and reads from
 * DIRECT_URL, so it backs up the database those are configured for — development by default.
 *
 * Usage:
 *   npm run db:backup
 */
async function main() {
  const target = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(unset)";
  console.log(`Backing up ${target.replace(/^https:\/\/([a-z0-9]+)\..*/, "$1")}…`);

  const result = await runDatabaseBackup();

  console.log(`\n  file    ${result.path}`);
  console.log(`  size    ${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  tables  ${result.tableCount}`);
  if (result.pruned > 0) console.log(`  pruned  ${result.pruned} archive(s) past the retention window`);
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
