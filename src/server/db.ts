import "server-only";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";

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
};

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
          const [, result] = await rawDb.$transaction([
            rawDb.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
            delegate[operation](scopedArgs) as never,
          ]);
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
  return rawDb.$transaction(async (tx: TenantTransactionClient) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
