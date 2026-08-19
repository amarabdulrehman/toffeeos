/**
 * The single source of truth for every granular permission in the product. Each key is an
 * independent boolean — matching VINC's permission-checklist depth (e.g. "Allow Edit POS Tax",
 * "Bypass Shift Time Restriction" are separate toggles, never bundled into one "POS access" flag).
 *
 * Adding a permission is one line here. The staff/roles admin UI (src/app/(app)/staff/*) renders
 * itself from PERMISSIONS_BY_MODULE, so it never needs a matching UI change. Server-side checks go
 * through requirePermission()/hasPermission() in ./check.ts; client-side through <Can perm="...">
 * in src/components/can.tsx.
 */

export interface PermissionDef {
  key: string;
  label: string;
  module: string;
}

function perm(module: string, action: string, label: string): PermissionDef {
  return { key: `${module}.${action}`, label, module };
}

export const PERMISSIONS: PermissionDef[] = [
  // ---- POS ----
  perm("pos", "access", "Access the POS terminal"),
  perm("pos", "order.create", "Create a new order"),
  perm("pos", "order.editItems", "Edit items on an open order"),
  perm("pos", "order.changeType", "Change order type (dine-in/takeaway/delivery/service)"),
  perm("pos", "order.void", "Void an entire order"),
  perm("pos", "order.voidLine", "Void a single line item"),
  perm("pos", "discount.applyLine", "Apply a line-level discount"),
  perm("pos", "discount.applyOrder", "Apply an order-level discount"),
  perm("pos", "discount.exceedMax", "Apply a discount beyond the configured max"),
  perm("pos", "tax.edit", "Manually edit tax on an order"),
  perm("pos", "tax.exempt", "Mark an order tax-exempt"),
  perm("pos", "payment.take", "Take payment on an order"),
  perm("pos", "payment.split", "Split payment across multiple methods"),
  perm("pos", "payment.refund", "Issue a refund"),
  perm("pos", "cashDrawer.openNoSale", "Open the cash drawer without a sale"),
  perm("pos", "shift.open", "Open a POS shift"),
  perm("pos", "shift.close", "Close a POS shift"),
  perm("pos", "shift.bypassTimeRestriction", "Bypass shift time restriction"),
  perm("pos", "pin.bypassVerification", "Bypass PIN verification"),
  perm("pos", "kot.print", "Print KOT (kitchen order ticket)"),
  perm("pos", "kot.reprint", "Reprint a KOT"),
  perm("pos", "receipt.print", "Print customer receipt"),
  perm("pos", "receipt.reprint", "Reprint a customer receipt"),

  // ---- Kitchen Display System ----
  perm("kds", "access", "Access the Kitchen Display System"),
  perm("kds", "item.markReady", "Mark a line item ready"),
  perm("kds", "order.markReady", "Mark a whole order ready"),
  perm("kds", "order.recall", "Recall a completed order back to active"),

  // ---- Tables & floor ----
  perm("tables", "view", "View the floor/table layout"),
  perm("tables", "manage", "Add/edit floors and tables"),
  perm("tables", "changeStatus", "Change a table's status"),
  perm("tables", "merge", "Merge tables for one order"),

  // ---- Orders / Order Queue ----
  perm("orders", "view", "View the order queue"),
  perm("orders", "viewAllBranches", "View orders across all branches"),
  perm("orders", "markPaid", "Mark an order paid"),
  perm("orders", "cancel", "Cancel an order"),

  // ---- Offline sync ----
  perm("sync", "conflict.resolve", "View and resolve offline-sync conflicts"),

  // ---- Delivery & riders ----
  perm("delivery", "view", "View delivery dispatch board"),
  perm("delivery", "assignRider", "Assign an order to a rider"),
  perm("delivery", "reassignRider", "Reassign an order to a different rider"),
  perm("delivery", "riderApp.access", "Access the rider mobile app"),
  perm("delivery", "confirmDropoff", "Confirm delivery drop-off (photo/OTP)"),
  perm("delivery", "manageRiders", "Add/edit riders"),

  // ---- Inventory ----
  perm("inventory", "view", "View stock levels"),
  perm("inventory", "location.manage", "Add/edit stock locations"),
  perm("inventory", "item.manage", "Add/edit inventory items"),
  perm("inventory", "grn.create", "Create a goods-received note"),
  perm("inventory", "transfer.create", "Create a stock transfer between branches"),
  perm("inventory", "transfer.approve", "Approve a stock transfer"),
  perm("inventory", "adjustment.create", "Create a stock adjustment"),
  perm("inventory", "adjustment.delete", "Delete a stock adjustment"),
  perm("inventory", "purchaseOrder.create", "Create a purchase order"),
  perm("inventory", "purchaseOrder.approve", "Approve a purchase order"),
  perm("inventory", "supplier.manage", "Add/edit suppliers"),
  perm("inventory", "lowStockAlert.configure", "Configure low-stock alert thresholds"),

  // ---- Recipe & costing ----
  perm("recipe", "view", "View item recipes"),
  perm("recipe", "manage", "Add/edit item recipes"),
  perm("costing", "viewMargins", "View cost/margin per item"),

  // ---- Menu ----
  perm("menu", "view", "View the menu"),
  perm("menu", "manage", "Add/edit categories, items, variants, modifiers"),
  perm("menu", "branchAvailability", "Toggle item availability per branch"),
  perm("menu", "priceOverride", "Override an item's price per branch"),

  // ---- CRM ----
  perm("crm", "view", "View customer profiles"),
  perm("crm", "manage", "Edit customer profiles"),
  perm("crm", "loyalty.adjust", "Manually adjust loyalty points"),
  perm("crm", "allergen.manage", "Manage customer allergen flags"),

  // ---- Reports ----
  perm("reports", "sales.view", "View sales reports"),
  perm("reports", "profit.view", "View gross profit / P&L reports"),
  perm("reports", "cancellation.view", "View cancellation report"),
  perm("reports", "discountVoid.view", "View the discount & void audit report"),
  perm("reports", "inventoryValuation.view", "View the inventory valuation report"),
  perm("reports", "riderPerformance.view", "View the rider performance report"),
  perm("reports", "staff.view", "View staff/waiter performance reports"),
  perm("reports", "export", "Export reports (CSV)"),

  // ---- Accounts & finance ----
  perm("finance", "expense.create", "Record an expense"),
  perm("finance", "expense.approve", "Approve an expense"),
  perm("finance", "pnl.view", "View P&L"),

  // ---- HR & payroll ----
  perm("hr", "employee.manage", "Add/edit employee records"),
  perm("hr", "shift.assign", "Assign staff shifts"),
  perm("hr", "attendance.edit", "Edit attendance records"),
  perm("hr", "payroll.run", "Run payroll"),
  perm("hr", "payroll.view", "View payroll/payslips"),

  // ---- Branch, staff & settings ----
  perm("branch", "manage", "Add/edit branches"),
  perm("staff", "invite", "Invite staff"),
  perm("staff", "manage", "Edit staff accounts"),
  perm("staff", "roles.manage", "Create/edit roles and permissions"),
  perm("settings", "tax.manage", "Edit tax rules"),
  perm("settings", "serviceCharge.manage", "Edit service charge settings"),
  perm("settings", "general.manage", "Edit general branch/tenant settings"),

  // ---- Billing (tenant-facing) ----
  perm("billing", "view", "View subscription & billing"),
  perm("billing", "plan.change", "Change subscription plan"),

  // ---- Online ordering & QR ----
  perm("online", "menu.manage", "Manage the online ordering menu"),
  perm("online", "qr.manage", "Manage QR table-ordering"),

  // ---- WhatsApp ----
  perm("whatsapp", "manage", "Manage WhatsApp settings, recipients, and templates"),
];

export const PERMISSION_KEYS: string[] = PERMISSIONS.map((p) => p.key);
export const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

export function isValidPermissionKey(key: string): boolean {
  return PERMISSION_KEY_SET.has(key);
}

export const PERMISSIONS_BY_MODULE: Record<string, PermissionDef[]> = PERMISSIONS.reduce(
  (acc, p) => {
    (acc[p.module] ??= []).push(p);
    return acc;
  },
  {} as Record<string, PermissionDef[]>
);

/**
 * The 6 standard tenant-side roles from the product brief, seeded per-tenant on signup with
 * isSystem = true. Tenants can add their own custom roles on top of these. The Platform Owner is
 * a separate PlatformUser model, not a Role row — it has no tenant scope at all.
 */
export const SEED_ROLES: Record<string, { name: string; permissions: string[] }> = {
  owner: {
    name: "Restaurant Owner",
    permissions: PERMISSION_KEYS, // full access to everything within their tenant
  },
  branch_manager: {
    name: "Branch Manager",
    // Full operational control within their own branch, but never cross-branch visibility —
    // that's what makes them a Branch (not Restaurant) Manager. See resolveReportBranchIds in
    // src/server/reports.ts, the only place this permission is checked.
    permissions: PERMISSION_KEYS.filter(
      (k) =>
        !k.startsWith("billing.") &&
        k !== "staff.roles.manage" &&
        k !== "branch.manage" &&
        k !== "orders.viewAllBranches"
    ),
  },
  cashier: {
    name: "Cashier",
    permissions: [
      "pos.access",
      "pos.order.create",
      "pos.order.editItems",
      "pos.order.changeType",
      "pos.order.voidLine",
      "pos.discount.applyLine",
      "pos.discount.applyOrder",
      "pos.payment.take",
      "pos.payment.split",
      "pos.cashDrawer.openNoSale",
      "pos.shift.open",
      "pos.shift.close",
      "pos.kot.print",
      "pos.receipt.print",
      "pos.receipt.reprint",
      "tables.view",
      "tables.changeStatus",
      "orders.view",
      "orders.markPaid",
      "crm.view",
      "crm.manage",
    ],
  },
  waiter: {
    name: "Waiter",
    permissions: [
      "pos.access",
      "pos.order.create",
      "pos.order.editItems",
      "pos.order.changeType",
      "pos.kot.print",
      "tables.view",
      "tables.changeStatus",
      "orders.view",
      "crm.view",
    ],
  },
  kitchen: {
    name: "Kitchen Staff",
    permissions: ["kds.access", "kds.item.markReady", "kds.order.markReady"],
  },
  rider: {
    name: "Rider",
    permissions: ["delivery.riderApp.access", "delivery.confirmDropoff"],
  },
};
