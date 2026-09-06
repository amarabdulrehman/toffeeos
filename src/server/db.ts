import "server-only";
import { setDefaultResultOrder } from "node:dns";
import { Pool } from "pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";

// Measured directly: on hosts where this runs, Node's default connection behavior for the Supabase
// pooler host took ~2 seconds per NEW TCP connection even though its DNS record is IPv4-only (no
// AAAA) — Node still attempts an IPv6 path first and eats the full timeout before falling back.
// Forcing IPv4-first cut a raw connect test from ~2060ms to ~140ms. Every tenantDb() query opens
// its own transaction (see the doc comment below), so with a small/cycling pg pool this ~2s tax
// was being paid over and over, not once at boot — almost certainly the dominant cause of
// system-wide perceived slowness, since the actual DB round trip once connected is fast. Set here,
// at the module that actually opens connections, rather than in instrumentation.ts's register()
// hook — Next.js dev mode's multi-worker architecture meant that ran in a different worker context
// than the one handling requests, so the setting never reached the connections that mattered.
setDefaultResultOrder("ipv4first");

export type TenantTransactionClient = Prisma.TransactionClient;

/**
 * Tenant isolation, Layer 1 (app layer). Layer 2 is the Postgres RLS policies in
 * prisma/migrations/*_rls_and_roles/migration.sql — this file is what makes Layer 2 actually
 * bite: every query issued through tenantDb() runs inside a one-statement transaction that first
 * sets the Postgres session variable RLS reads (`app.tenant_id`), so even if the where-injection
 * below had a bug, the database itself would still refuse to return another tenant's rows.
 *
 * Three separate PrismaClient connections, deliberately never mixed:
 *   - rawDb        internal only (this file). Connects as `app_user` (RLS-bound). Never import
 *                   this directly from route handlers — go through tenantDb()/runInTenantTransaction().
 *   - platformDb    connects as `platform_user` (BYPASSRLS). It can see every tenant's data, so
 *                   it's normally only imported by (platform) super-admin route handlers. The one
 *                   other legitimate case is a public route holding an unguessable single-use
 *                   token (invite accept, impersonation hand-off) that must resolve to a tenant
 *                   *before* any tenant context exists to scope an RLS-bound query by — the token
 *                   itself is the authorization there, same reasoning as findTenantBySlug reading
 *                   the tenant-less Tenant table directly. See src/server/staff-invites.ts.
 *   - tenantDb(id)  what ~everything else uses. Auto-injects `tenantId` into every query for
 *                   models in TENANT_SCOPED_MODELS, AND sets the RLS session var, per call.
 */

const globalForPrisma = globalThis as unknown as {
  __tableosRawDb?: PrismaClient;
  __tableosPlatformDb?: PrismaClient;
  __tableosRawPool?: Pool;
};

/**
 * Same role/connection string as rawDb (app_user, RLS-bound) — for the handful of extremely hot,
 * fixed-shape queries where Prisma's own $transaction([set_config, query]) array form costs 4
 * separate network round trips (BEGIN, the set_config, the query, COMMIT — measured directly
 * against this app's remote Postgres at ~150-180ms *each*, since Prisma doesn't pipeline them).
 * A hand-written query combining set_config and the real SELECT into one multi-statement string,
 * sent via node-postgres directly, executes as ONE round trip instead — Postgres's simple query
 * protocol treats a multi-statement string as an implicit transaction, so set_config's
 * transaction-local scope (is_local=true) is exactly as safe under pgbouncer's transaction-mode
 * pooling as Prisma's version; nothing about the RLS/tenant-isolation guarantee changes, only the
 * number of round trips. This is deliberately NOT how every query works — Prisma's adapter can't
 * parse a multi-result-set raw response (confirmed: it throws), so this only applies where the SQL
 * is simple and hand-written, which is why it's reserved for getTenantGateRaw/getTenantLayoutDataRaw
 * in src/server/tier.ts (the one query every single authenticated request/page load pays for) and
 * not generalized into tenantDb() itself.
 */
export const rawPool: Pool =
  globalForPrisma.__tableosRawPool ?? new Pool({ connectionString: env.DATABASE_URL });

// Prisma 7 connects only through a driver adapter (no more bare `datasourceUrl` string) — each
// runtime role gets its own adapter instance over its own connection string, which is what
// actually keeps the two connections (and thus the two Postgres roles) from ever mixing.
export const rawDb: PrismaClient =
  globalForPrisma.__tableosRawDb ??
  new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

export const platformDb: PrismaClient =
  globalForPrisma.__tableosPlatformDb ??
  new PrismaClient({ adapter: new PrismaPg({ connectionString: env.PLATFORM_DATABASE_URL }) });

if (env.NODE_ENV !== "production") {
  globalForPrisma.__tableosRawDb = rawDb;
  globalForPrisma.__tableosPlatformDb = platformDb;
  globalForPrisma.__tableosRawPool = rawPool;
}

/**
 * Every model that carries a `tenantId` column, i.e. every model RLS-protects in the migration
 * above. Prisma 7's generated client doesn't expose a runtime DMMF to derive this list
 * automatically, so it is hand-maintained — keep it in sync with the ARRAY in
 * prisma/migrations/*_rls_and_roles/migration.sql and with schema.prisma whenever either changes.
 * (Tenant, Plan, Subscription's parent Plan, and PlatformUser are deliberately absent: Tenant IS
 * the tenant, and the other two are platform-only.)
 */
const TENANT_SCOPED_MODELS = new Set([
  "Branch",
  "BranchSettings",
  "TaxRule",
  "User",
  "Role",
  "Membership",
  "Invite",
  "StaffPin",
  "Category",
  "MenuItem",
  "ItemVariant",
  "ModifierGroup",
  "Modifier",
  "MenuItemModifierGroup",
  "BranchMenuItem",
  "Floor",
  "RestaurantTable",
  "Customer",
  "CustomerAddress",
  "Order",
  "OrderLine",
  "OrderLineModifier",
  "OrderDiscount",
  "Payment",
  "OrderEvent",
  "Subscription",
  "AuditLog",
  "StockLocation",
  "InventoryItem",
  "StockLevel",
  "StockMovement",
  "LowStockAlert",
  "RecipeLine",
  "SyncActionLog",
  "SyncConflict",
  "WhatsAppSettings",
  "WhatsAppRecipient",
  "WhatsAppTemplate",
  "WhatsAppMessageLog",
  "Shift",
  "AttendanceRecord",
  "SubscriptionPayment",
  "PayrollDisbursement",
  "OrderCancellation",
  "ExpenseCategory",
  "Expense",
  "RecurringExpense",
  "CashDrawerDay",
]);

const WHERE_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

function lowerFirst(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * P2028 ("Unable to start a transaction in the given time") is Prisma failing to acquire a pool
 * slot before the transaction's first statement runs — observed under concurrent load against
 * this app's pooled Supabase connection (confirmed via load testing: ~15% of requests fail this
 * way at ~40 concurrent hits on one endpoint). Because it fails before anything executes, retrying
 * is safe — there's no partial-write ambiguity, only "the pool was momentarily out of slots."
 * Matches this app's own prior observation (see the OtpCode/RateLimitHit era comments) that these
 * self-recover on retry. One retry after a short jittered backoff meaningfully cuts the user-facing
 * failure rate without masking a real, non-transient error (anything other than P2028 rethrows
 * immediately, unretried).
 */
// Prisma's defaults (maxWait: 2000ms to acquire a pool slot, timeout: 5000ms transaction body
// budget) are tuned for a dedicated/local Postgres, not a shared pooled connection under real
// concurrent load — the load test that surfaced P2028 (see withTransientRetry) hit that 2s ceiling
// well before the transaction itself was ever slow. The transaction body here is always just
// [set_config, one query], so the risk of raising `timeout` is minimal; the payoff is giving
// contended requests real room to actually acquire a slot instead of failing fast.
const TENANT_TX_OPTIONS = { maxWait: 8000, timeout: 10000 };

async function withTransientRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
      await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 150));
      return run();
    }
    throw err;
  }
}

/**
 * Mutates (returns a new copy of) query args so the operation can only ever touch this tenant's
 * rows. Documented boundary: this only scopes the TOP-LEVEL model of the call. Nested writes
 * (e.g. `order.create({ data: { lines: { create: [...] } } })`) do NOT get their nested model
 * auto-scoped — the money-critical order-creation flow avoids nested writes entirely for exactly
 * this reason (see src/server/orders.ts), and any other nested write must set tenantId on the
 * nested `data` by hand.
 */
function injectTenantScope(operation: string, args: unknown, tenantId: string): unknown {
  const a = { ...(args as Record<string, unknown> | undefined) };

  if (WHERE_OPERATIONS.has(operation)) {
    a.where = { ...(a.where as Record<string, unknown> | undefined), tenantId };
  }

  if (operation === "create") {
    a.data = { ...(a.data as Record<string, unknown> | undefined), tenantId };
  }

  if (operation === "createMany" || operation === "createManyAndReturn") {
    const data = a.data as Record<string, unknown>[] | Record<string, unknown> | undefined;
    a.data = Array.isArray(data) ? data.map((d) => ({ ...d, tenantId })) : { ...data, tenantId };
  }

  if (operation === "upsert") {
    a.where = { ...(a.where as Record<string, unknown> | undefined), tenantId };
    a.create = { ...(a.create as Record<string, unknown> | undefined), tenantId };
    // deliberately do NOT stamp tenantId into `update` — it should never change on an existing row
  }

  return a;
}

/**
 * The default way application code (via defineHandler in src/server/handler.ts) talks to the
 * database. Each call is wrapped in its own single-statement Postgres transaction that sets
 * app.tenant_id via set_config(..., true) (transaction-local, so it's safe under the Supabase
 * pgbouncer transaction pooler — a plain `SET LOCAL` would not survive to a second round trip on
 * a pooled connection, but bundling [set_config, the real query] into one Prisma batch
 * transaction keeps both statements on the same physical connection).
 */
export function tenantDb(tenantId: string): PrismaClient {
  if (!tenantId) throw new Error("tenantDb() called without a tenantId");

  return rawDb.$extends({
    name: `tenant-scope:${tenantId}`,
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
        }: {
          model?: string;
          operation: string;
          args: unknown;
        }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            // Not a tenant-scoped model (shouldn't normally happen via tenantDb — such models
            // belong on rawDb/platformDb directly) — still run it, but without scoping.
            const delegate = (rawDb as unknown as Record<string, Record<string, (a: unknown) => unknown>>)[
              lowerFirst(model ?? "")
            ];
            return delegate[operation](args);
          }
          const scopedArgs = injectTenantScope(operation, args, tenantId);
          const delegate = (rawDb as unknown as Record<string, Record<string, (a: unknown) => unknown>>)[
            lowerFirst(model)
          ];
          // Tried switching this to an interactive transaction ($transaction(async (tx) => ...))
          // to chase the "Calling client.query() when the client is already executing a query" pg
          // deprecation warning this whole file trips on nearly every request — reverted after
          // actually measuring it. Traced the real cause with `node --trace-deprecation`: it's
          // Prisma's own client-side query interpreter (@prisma/query-plan-executor) fanning a
          // findMany's nested `include`s out into separate sub-queries dispatched concurrently
          // (Array.map over the plan's children) against the ONE connection this transaction holds
          // — not the array-vs-interactive transaction form, which turned out to be unrelated
          // (confirmed: switching it here didn't change the warning at all). It's also not
          // deterministic — the same nested-include query triggered it on one request and not the
          // next, meaning it depends on real request timing/latency, not on any query shape I could
          // reliably restructure around. And it's confirmed harmless for correctness: set_config's
          // transaction-local scope covers the whole transaction regardless of how many sub-queries
          // race inside it, so RLS scoping is never in question. Fixing the warning itself would
          // mean rewriting how nested `include` queries execute app-wide (or waiting on a Prisma/pg
          // adapter fix upstream) — real work, but disproportionate to what is, today, a cosmetic
          // warning with no observed correctness or security impact. Left as array-form, unchanged.
          const [, result] = await withTransientRetry(() =>
            rawDb.$transaction(
              [
                rawDb.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
                delegate[operation](scopedArgs) as never,
              ],
              TENANT_TX_OPTIONS
            )
          );
          return result;
        },
      },
    },
  }) as unknown as PrismaClient;
}

/**
 * For the small number of flows that must write to several tables atomically (order + its lines
 * + its opening event; tenant signup creating Tenant + Branch + roles + settings in one go). The
 * callback is handed the raw interactive-transaction client and MUST set `tenantId` explicitly on
 * every create/where itself — there is no auto-injection inside an interactive transaction (the
 * transaction client type doesn't support `$extends`), which is precisely why these call sites are
 * kept few, colocated in src/server/*.ts business-logic modules, and hand-audited rather than
 * scattered through route handlers.
 */
export async function runInTenantTransaction<T>(
  tenantId: string,
  fn: (tx: TenantTransactionClient) => Promise<T>
): Promise<T> {
  return withTransientRetry(() =>
    rawDb.$transaction(async (tx: TenantTransactionClient) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    }, TENANT_TX_OPTIONS)
  );
}
