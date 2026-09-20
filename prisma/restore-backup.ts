import "dotenv/config";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";

/**
 * Restores a backup produced by src/server/backup.ts.
 *
 * The backups were being written nightly and had never been restored, which means they were an
 * assumption rather than a recovery plan. There was no restore path in the codebase at all — this
 * is it.
 *
 * Two decisions worth knowing:
 *
 * - It runs inside `SET session_replication_role = replica`, which suspends foreign-key triggers
 *   for the session. A JSON dump has no dependency ordering, and reconstructing one by hand for 55
 *   models is exactly the kind of thing that works until a new relation is added and then silently
 *   isn't. Suspending the checks and restoring wholesale is what pg_restore does for the same
 *   reason. Constraints are re-enabled at the end, and the whole thing is one transaction — a
 *   failure rolls back to where you started rather than leaving a half-restored database.
 *
 * - It refuses to run against production unless ALLOW_PROD_RESTORE=1 is set. Restoring is a
 *   destructive operation on the target: every table it touches is emptied first. That is correct
 *   for disaster recovery and catastrophic anywhere else.
 *
 * Usage:
 *   npx tsx prisma/restore-backup.ts                    # newest backup in the bucket
 *   npx tsx prisma/restore-backup.ts full-backup-2026-09-10.json.gz
 */
const PROD_REF = "ntzwlkgqzkxworwuiqlh";
const BUCKET = "db-backups";

/**
 * Rows per INSERT.
 *
 * This used to be one statement per row. That is fine against the development database — nine
 * thousand rows — and it is the wrong shape for the only situation this script exists for: a real
 * café's database, a year in, restored during an incident. Hundreds of thousands of individual
 * round trips inside a single transaction is where a restore stops being slow and starts timing
 * out, which you would discover on the worst possible day.
 *
 * Batched, so it is a few thousand statements rather than a few hundred thousand. Postgres caps a
 * statement at 65535 bound parameters and rows x columns is what counts against it — the widest
 * table today is Order at 39, so 500 rows is 19,500. Rather than leave that as a comment that stops
 * being true the day someone adds a wide table, the batch is clamped per table below.
 */
const ROWS_PER_INSERT = 500;
const PG_MAX_PARAMS = 65535;

/** Order matters only for the emptying pass; inserts run with FK triggers suspended. */
function tablesInDump(dump: Record<string, unknown[]>): string[] {
  return Object.keys(dump);
}

async function main() {
  const directUrl = process.env.DIRECT_URL ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!directUrl || !supabaseUrl || !serviceKey) throw new Error("DIRECT_URL / Supabase env vars missing.");

  const targetIsProd = directUrl.includes(PROD_REF);
  if (targetIsProd && process.env.ALLOW_PROD_RESTORE !== "1") {
    throw new Error(
      "DIRECT_URL points at PRODUCTION. Restoring empties every table it touches. " +
        "Re-run with ALLOW_PROD_RESTORE=1 only if you actually intend to overwrite production."
    );
  }

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let name = process.argv[2];
  if (!name) {
    const { data, error } = await sb.storage.from(BUCKET).list();
    if (error) throw new Error(`Could not list backups: ${error.message}`);
    const backups = (data ?? []).filter((f) => f.name.startsWith("full-backup-")).sort((a, b) => (a.name < b.name ? 1 : -1));
    if (!backups.length) throw new Error("No backups in the bucket.");
    name = backups[0].name;
  }
  console.log(`Restoring ${name} into ${targetIsProd ? "PRODUCTION" : "the dev database"}\n`);

  const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(name);
  if (dlErr || !blob) throw new Error(`Download failed: ${dlErr?.message}`);
  const dump = JSON.parse(gunzipSync(Buffer.from(await blob.arrayBuffer())).toString("utf-8")) as Record<string, unknown[]>;

  const tables = tablesInDump(dump);
  const totalRows = tables.reduce((n, t) => n + (dump[t]?.length ?? 0), 0);
  console.log(`${tables.length} tables, ${totalRows} rows in the archive`);

  const c = new Client({ connectionString: directUrl, connectionTimeoutMillis: 30000 });
  await c.connect();

  let restored = 0;
  await c.query("BEGIN");
  try {
    await c.query("SET session_replication_role = replica");

    for (const table of tables) await c.query(`DELETE FROM "${table}"`);

    for (const table of tables) {
      const rows = (dump[table] ?? []) as Record<string, unknown>[];
      if (!rows.length) continue;

      // Columns come from the union of every row, not from rows[0]. Prisma returns a consistent
      // shape today, so in practice these are the same — but "the first row defines the insert for
      // all the others" is the kind of assumption that holds until one table does something
      // slightly different, and then drops a column's data silently during a restore.
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const quoted = cols.map((col) => `"${col}"`).join(", ");

      // Clamped, so a future table wide enough to matter shortens the batch instead of failing.
      const perBatch = Math.max(1, Math.min(ROWS_PER_INSERT, Math.floor(PG_MAX_PARAMS / cols.length)));

      for (let start = 0; start < rows.length; start += perBatch) {
        const batch = rows.slice(start, start + perBatch);
        const params: unknown[] = [];
        const tuples = batch.map((row) => {
          const placeholders = cols.map((col) => {
            const v = row[col] ?? null;
            // JSON round-trips objects/arrays; pg wants them as-is for json/jsonb and text[] columns.
            params.push(v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v);
            return `$${params.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        await c.query(`INSERT INTO "${table}" (${quoted}) VALUES ${tuples.join(", ")}`, params);
        restored += batch.length;
      }
    }

    await c.query("SET session_replication_role = DEFAULT");
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    await c.end();
    throw e;
  }

  console.log(`\nRestored ${restored} rows across ${tables.length} tables.`);

  // Then prove it, rather than trusting an exit code. A restore that landed the wrong number
  // of rows somewhere is exactly the failure worth catching here and not during an incident.
  const mismatches: string[] = [];
  for (const table of tables) {
    const expected = (dump[table] ?? []).length;
    const { rows: got } = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table}"`);
    const actual = Number(got[0].n);
    if (actual !== expected) mismatches.push(`  ${table}: archive has ${expected}, database has ${actual}`);
  }
  if (mismatches.length > 0) {
    console.error(`
ROW COUNTS DO NOT MATCH in ${mismatches.length} table(s):`);
    mismatches.forEach((m) => console.error(m));
    await c.end();
    process.exit(1);
  }
  console.log("Verified: every table matches the archive's row count.");
  await c.end();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
