/**
 * The tenant-owned table list, kept out of src/server/platform.ts on purpose: that module is
 * `server-only`, and the test that proves this list has not drifted from the database has to be
 * able to import it. Same reason src/lib/recurrence.ts sits here rather than in the server module
 * that uses it.
 */

/**
 * Every table carrying a tenantId, ordered children-first so each DELETE runs after the rows that
 * reference it are already gone. Derived from the live foreign-key graph rather than written by
 * hand, then frozen here so a destructive operation is reviewable rather than clever.
 *
 * Kept as an explicit list for the same reason ALL_MODELS in src/server/backup.ts is: Prisma 7's
 * client exposes no runtime model introspection. Unlike that one, this list is enforced — the test
 * in e2e/tenant-delete.spec.ts fails if the database grows a tenantId column this list is missing,
 * because a forgotten table here means orphaned rows for a restaurant that no longer exists.
 *
 * The five tables deliberately absent are the ones with no tenantId at all: Plan, PlatformUser and
 * RateLimitHit are platform-wide, OtpCode is keyed by email/phone rather than tenant and expires on
 * its own, and Tenant itself is deleted last, separately.
 */
export const TENANT_OWNED_TABLES = [
  "OrderEvent",
  "Payment",
  "OrderDiscount",
  "OrderLineModifier",
  "OrderLine",
  "CustomerAddress",
  "Membership",
  "BranchSettings",
  "RecurringExpense",
  "Expense",
  "ExpenseCategory",
  "Order",
  "RestaurantTable",
  "Floor",
  "Customer",
  "RecipeLine",
  "OrderCancellation",
  "PayrollDisbursement",
  "ImpersonationToken",
  "PasswordResetToken",
  "SubscriptionPayment",
  "Subscription",
  "AttendanceRecord",
  "Shift",
  "SyncConflict",
  "SyncActionLog",
  "AuditLog",
  "BranchMenuItem",
  "MenuItemModifierGroup",
  "Modifier",
  "LowStockAlert",
  "StockMovement",
  "ModifierGroup",
  "ItemVariant",
  "MenuItem",
  "Category",
  "StockLevel",
  "StaffPin",
  "Invite",
  "Role",
  "TaxRule",
  "User",
  "InventoryItem",
  "StockLocation",
  "Branch",
  "WhatsAppMessageLog",
  "WhatsAppTemplate",
  "WhatsAppRecipient",
  "WhatsAppSettings",
] as const;

