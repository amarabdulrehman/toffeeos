import "dotenv/config";
import { Client } from "pg";

/**
 * Gives every category a distinct sortOrder.
 *
 * The menu endpoints order by sortOrder. Until recently the seed never set it, so every category a
 * seeded tenant has shares the value 0 — and a query ordered on a column where every row ties is
 * free to come back in any order the planner likes. It came back insertion-ordered for months and
 * then, once the table grew, stopped: the POS shows one category at a time and opens on the first
 * one, so the menu appeared to rearrange itself between page loads.
 *
 * The endpoints now tie-break on name, which makes the order stable. It does not make it *right* —
 * a tenant whose categories are all still 0 now reads alphabetically, so a café opens on "BBQ"
 * instead of "Starters". The seed fix only applies to tenants seeded after it. This is the fix for
 * the ones that already exist.
 *
 * Two modes:
 *
 *   --order "Starters,BBQ,Karahi"   put these first, in this order; everything else keeps its
 *                                   current relative order behind them
 *   (no --order)                    just normalise: hand out 0..n-1 following the order the app
 *                                   currently displays, changing nothing anyone can see while
 *                                   removing the ties permanently
 *
 * Dry run unless --apply is passed, because this writes to whatever DIRECT_URL points at and that
 * is usually production. The dry run prints exactly what it would change.
 *
 * Usage:
 *   npm run db:order-menu -- --tenant karachi-karahi
 *   npm run db:order-menu -- --tenant karachi-karahi --order "Starters,BBQ,Karahi,Rice & Biryani,Bread,Beverages,Desserts" --apply
 */

interface Row {
  id: string;
  name: string;
  sortOrder: number;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const slug = arg("--tenant");
  const orderArg = arg("--order");
  const apply = process.argv.includes("--apply");

  if (!process.env.DIRECT_URL) throw new Error("DIRECT_URL is not set.");

  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  try {
    if (!slug) {
      const { rows } = await c.query<{ slug: string; name: string }>(
        `SELECT slug, name FROM "Tenant" ORDER BY name`
      );
      console.log("Pass --tenant <slug>. Tenants on this database:\n");
      rows.forEach((t) => console.log(`  ${t.slug.padEnd(24)} ${t.name}`));
      return;
    }

    const tenant = await c.query<{ id: string; name: string }>(
      `SELECT id, name FROM "Tenant" WHERE slug = $1`,
      [slug]
    );
    if (tenant.rowCount === 0) throw new Error(`No tenant with slug "${slug}".`);
    const { id: tenantId, name: tenantName } = tenant.rows[0];

    // Exactly the order the app shows today, so "no --order" is genuinely a no-op visually.
    const { rows: current } = await c.query<Row>(
      `SELECT id, name, "sortOrder" FROM "Category"
        WHERE "tenantId" = $1
        ORDER BY "sortOrder" ASC, name ASC`,
      [tenantId]
    );
    if (current.length === 0) {
      console.log(`${tenantName} has no categories.`);
      return;
    }

    let desired: Row[];
    if (orderArg) {
      const wanted = orderArg.split(",").map((s) => s.trim()).filter(Boolean);
      const byName = new Map(current.map((r) => [r.name.toLowerCase(), r]));
      const picked: Row[] = [];
      const missing: string[] = [];
      for (const name of wanted) {
        const row = byName.get(name.toLowerCase());
        if (!row) {
          missing.push(name);
          continue;
        }
        if (!picked.includes(row)) picked.push(row);
      }
      // Named but absent is almost always a typo, and silently ignoring it would leave the café
      // with a menu that is only partly in the order they asked for.
      if (missing.length > 0) {
        throw new Error(
          `${tenantName} has no category called: ${missing.join(", ")}.\n` +
            `Its categories are: ${current.map((r) => r.name).join(", ")}`
        );
      }
      desired = [...picked, ...current.filter((r) => !picked.includes(r))];
    } else {
      desired = current;
    }

    const changes = desired
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) => row.sortOrder !== index);

    console.log(`${tenantName} (${slug}) — ${current.length} categories\n`);
    desired.forEach((row, index) => {
      const moved = row.sortOrder !== index;
      console.log(
        `  ${String(index).padStart(2)}  ${row.name.padEnd(28)} ${moved ? `was ${row.sortOrder}` : ""}`
      );
    });

    if (changes.length === 0) {
      console.log("\nAlready in order, nothing to do.");
      return;
    }

    if (!apply) {
      console.log(`\n${changes.length} categor${changes.length === 1 ? "y" : "ies"} would change. Re-run with --apply to write.`);
      return;
    }

    // One transaction: a half-applied reorder is a menu in an order nobody chose.
    await c.query("BEGIN");
    for (const { row, index } of changes) {
      await c.query(`UPDATE "Category" SET "sortOrder" = $1 WHERE id = $2`, [index, row.id]);
    }
    await c.query("COMMIT");
    console.log(`\nApplied. ${changes.length} categor${changes.length === 1 ? "y" : "ies"} updated.`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
