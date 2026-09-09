import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * TENANT_SCOPED_MODELS in src/server/db.ts is the list tenantDb() consults to decide whether to
 * inject a tenantId filter and set the RLS session variable. A model missing from it takes an early
 * return that skips BOTH — the query runs on the raw client with no tenant context at all.
 *
 * The list is hand-maintained (Prisma 7 exposes no runtime model introspection to derive it from),
 * and its own comment says to keep it in sync with the schema. Nothing enforced that, and it had in
 * fact drifted: ImpersonationToken and PasswordResetToken both carry a tenantId and were absent.
 *
 * That particular drift was harmless — both are reached only via platformDb, and RLS would have
 * failed closed (zero rows) rather than leaking if they ever weren't. But "harmless this time"
 * is the wrong thing to rely on for the mechanism the whole multi-tenant story rests on, so it's
 * pinned here instead.
 *
 * Reads both files as text rather than importing them: src/server/db.ts is `server-only`, which
 * throws outside a React Server Component, and every other test in this suite imports from
 * @/lib/* for exactly that reason.
 */

const repoRoot = path.resolve(__dirname, "..");
const schema = readFileSync(path.join(repoRoot, "prisma/schema.prisma"), "utf8");
const dbSource = readFileSync(path.join(repoRoot, "src/server/db.ts"), "utf8");

/** Every model in schema.prisma declaring a `tenantId` scalar field. */
function modelsWithTenantId(): string[] {
  const found: string[] = [];
  let current: string | null = null;
  for (const line of schema.split("\n")) {
    const model = line.match(/^model\s+(\w+)\s*\{/);
    if (model) {
      current = model[1];
      continue;
    }
    if (line.startsWith("}")) {
      current = null;
      continue;
    }
    if (current && /^\s+tenantId\s+/.test(line)) {
      found.push(current);
      current = null; // one hit per model is enough
    }
  }
  return found.sort();
}

/** The literal entries of the TENANT_SCOPED_MODELS set. */
function declaredScopedModels(): string[] {
  const block = dbSource.match(/const TENANT_SCOPED_MODELS = new Set\(\[([\s\S]*?)\]\)/);
  if (!block) throw new Error("Could not find TENANT_SCOPED_MODELS in src/server/db.ts");
  return [...block[1].matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
}

describe("TENANT_SCOPED_MODELS", () => {
  it("covers every model that carries a tenantId", () => {
    const missing = modelsWithTenantId().filter((m) => !declaredScopedModels().includes(m));
    expect(
      missing,
      `These models declare a tenantId but are absent from TENANT_SCOPED_MODELS in src/server/db.ts. ` +
        `tenantDb() will run them with no tenant filter and no RLS session variable. Add them to the list.`
    ).toEqual([]);
  });

  it("has no stale entries naming models that no longer exist", () => {
    const withTenantId = modelsWithTenantId();
    const stale = declaredScopedModels().filter((m) => !withTenantId.includes(m));
    expect(
      stale,
      `These are listed in TENANT_SCOPED_MODELS but no longer declare a tenantId in schema.prisma. ` +
        `Either the model was renamed/removed, or it lost the column — check which, then update the list.`
    ).toEqual([]);
  });

  it("actually found models to check, so a parsing failure can't pass silently", () => {
    // Without this, a regex that quietly matched nothing would make both assertions above compare
    // [] to [] and report success while checking nothing at all.
    expect(modelsWithTenantId().length).toBeGreaterThan(40);
    expect(declaredScopedModels().length).toBeGreaterThan(40);
  });
});
