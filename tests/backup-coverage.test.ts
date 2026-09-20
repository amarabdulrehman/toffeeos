import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Every model in the schema has to be in the backup.
 *
 * `runDatabaseBackup` dumps a hand-maintained list of model names, because Prisma 7 stopped
 * exposing model introspection at runtime the way earlier versions did. That list is the single
 * point where the free-tier backup story quietly fails: add a model to the schema, forget this
 * list, and every backup taken from then on is missing that table. Nothing errors. The file still
 * uploads, still looks the right shape, and the gap is only discovered on the day someone needs to
 * restore — which is the worst possible day to discover it.
 *
 * Refund is the live example. It was added the same week refunds were built, and if it had been
 * missed, a restore would have brought back orders with their refunds erased: every refunded order
 * reading as fully paid, money the restaurant had given back counted as revenue again.
 *
 * Reads both files as text. src/server/backup.ts imports `server-only`, which throws under vitest,
 * and importing it would also construct a Supabase client from env vars that do not exist here.
 */

const ROOT = path.join(__dirname, "..");

function schemaModels(): string[] {
  const schema = readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf-8");
  return [...schema.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{/gm)].map((m) => m[1]).sort();
}

function backedUpModels(): string[] {
  const source = readFileSync(path.join(ROOT, "src", "server", "backup.ts"), "utf-8");
  const block = source.match(/const ALL_MODELS = \[([\s\S]*?)\] as const;/);
  if (!block) throw new Error("Could not find ALL_MODELS in src/server/backup.ts — has it been renamed?");
  return [...block[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]).sort();
}

describe("database backup coverage", () => {
  it("backs up every model in the schema", () => {
    const missing = schemaModels().filter((m) => !backedUpModels().includes(m));
    expect(
      missing,
      "these models are in prisma/schema.prisma but not in ALL_MODELS, so they are absent from " +
        "every backup taken from now on — add them to src/server/backup.ts"
    ).toEqual([]);
  });

  it("does not list models the schema no longer has", () => {
    // A stale name would throw at runtime — dumpAllTables looks up `client[lowerFirst(model)]` and
    // calls findMany on it — taking the whole nightly backup down rather than one table with it.
    const stale = backedUpModels().filter((m) => !schemaModels().includes(m));
    expect(stale, "these are in ALL_MODELS but not in the schema; the nightly job would throw").toEqual([]);
  });

  it("finds a real list rather than passing on an empty one", () => {
    // Both assertions above are satisfied by two empty arrays, which is exactly what a renamed
    // constant or a changed format would produce.
    expect(schemaModels().length).toBeGreaterThan(40);
    expect(backedUpModels()).toHaveLength(schemaModels().length);
    expect(backedUpModels(), "the model that would have erased refunds on restore").toContain("Refund");
  });
});
