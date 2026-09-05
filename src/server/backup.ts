import "server-only";
import { gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { platformDb } from "@/server/db";

/**
 * The free-tier answer to "Supabase gives us zero automated backups on this plan": a daily full
 * export of every table to Supabase Storage (already included in the free plan's 1GB, no new
 * account/service needed). Deliberately NOT a substitute for a real managed backup (Supabase Pro's
 * daily-backups-with-PITR) — this protects against the more common real-world case (a bad
 * migration, an accidental delete, an application bug that corrupts data), not a catastrophic
 * Supabase-side data-loss event, since the backups live in the same project as the data they're
 * backing up. Upgrade to Pro once the cost is justified by real revenue; until then, this is
 * something rather than nothing.
 *
 * Restoring from one of these isn't scripted (deliberately — a generic restore across 51 tables
 * with FK ordering and RLS is a lot of untested surface to build blind). If it's ever actually
 * needed: download the .json.gz from the "db-backups" bucket, gunzip it, and it's a plain
 * `{ [ModelName]: row[] }` object — write a targeted restore for whatever actually broke rather
 * than a generic one that's never been exercised against a real incident.
 */
const BACKUPS_BUCKET = "db-backups";
const RETENTION_DAYS = 14;

// Every model in prisma/schema.prisma, hand-maintained the same way TENANT_SCOPED_MODELS in
// db.ts is — Prisma 7's generated client doesn't expose runtime dmmf model introspection the way
// earlier versions did. Update this list whenever a model is added to or removed from the schema.
const ALL_MODELS = [
  "Plan",
  "Tenant",
  "Subscription",
  "SubscriptionPayment",
  "PlatformUser",
  "OtpCode",
  "ImpersonationToken",
  "RateLimitHit",
  "PasswordResetToken",
  "AuditLog",
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
  "StockLocation",
  "InventoryItem",
  "RecipeLine",
  "StockLevel",
  "StockMovement",
  "LowStockAlert",
  "Customer",
  "CustomerAddress",
  "WhatsAppSettings",
  "WhatsAppRecipient",
  "WhatsAppTemplate",
  "WhatsAppMessageLog",
  "Order",
  "SyncActionLog",
  "SyncConflict",
  "OrderLine",
  "OrderLineModifier",
  "OrderDiscount",
  "Payment",
  "OrderEvent",
  "Shift",
  "AttendanceRecord",
  "OrderCancellation",
  "PayrollDisbursement",
  "ExpenseCategory",
  "Expense",
  "RecurringExpense",
] as const;

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

const storageClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const { data: buckets } = await storageClient.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BACKUPS_BUCKET)) {
    const { error } = await storageClient.storage.createBucket(BACKUPS_BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  bucketEnsured = true;
}

/** platformDb (BYPASSRLS) is what makes a single unfiltered findMany() per table return every
 * tenant's rows at once — the same reason platform admin routes use it instead of tenantDb(). */
async function dumpAllTables(): Promise<Record<string, unknown[]>> {
  const dump: Record<string, unknown[]> = {};
  const client = platformDb as unknown as Record<string, { findMany: () => Promise<unknown[]> }>;
  for (const model of ALL_MODELS) {
    dump[model] = await client[lowerFirst(model)].findMany();
  }
  return dump;
}

async function pruneOldBackups(): Promise<number> {
  const { data: files } = await storageClient.storage.from(BACKUPS_BUCKET).list();
  if (!files) return 0;
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const stale = files.filter(
    (f) => f.name.startsWith("full-backup-") && new Date(f.created_at ?? 0).getTime() < cutoff
  );
  if (stale.length === 0) return 0;
  await storageClient.storage.from(BACKUPS_BUCKET).remove(stale.map((f) => f.name));
  return stale.length;
}

export async function runDatabaseBackup(): Promise<{ path: string; sizeBytes: number; tableCount: number; pruned: number }> {
  await ensureBucket();

  const dump = await dumpAllTables();
  const gzipped = gzipSync(Buffer.from(JSON.stringify(dump), "utf-8"));

  const path = `full-backup-${new Date().toISOString().slice(0, 10)}.json.gz`;
  const { error } = await storageClient.storage.from(BACKUPS_BUCKET).upload(path, gzipped, {
    contentType: "application/gzip",
    upsert: true,
  });
  if (error) throw new Error(`Backup upload failed: ${error.message}`);

  const pruned = await pruneOldBackups();
  return { path, sizeBytes: gzipped.byteLength, tableCount: ALL_MODELS.length, pruned };
}
