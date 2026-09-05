"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  UtensilsCrossed,
  ChefHat,
  LayoutGrid,
  BookOpen,
  Package,
  Truck,
  Users,
  MessageCircle,
  Globe,
  BarChart3,
  Receipt,
  Wallet,
  RefreshCw,
  UserPlus,
  Building2,
  type LucideIcon,
} from "lucide-react";
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown if the user has ANY of these permissions. Omitted = always shown (Dashboard). */
  anyPermission?: string[];
  /** Gateable module key (see GATEABLE_MODULES in lib/tiers.ts) — the tenant's enabledModules must
   * include this for the item to show at all, composes with anyPermission, not a replacement for
   * it (a Cashier at a tenant with Inventory enabled still can't see Inventory without the
   * permission too). */
  module?: string;
}

const NAV: NavItem[] = [
  { href: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pos", label: "POS", icon: UtensilsCrossed, anyPermission: ["pos.access"] },
  { href: "/kds", label: "KDS", icon: ChefHat, anyPermission: ["kds.access"] },
  { href: "/app/tables", label: "Tables", icon: LayoutGrid, anyPermission: ["tables.view"] },
  { href: "/app/menu", label: "Menu", icon: BookOpen, anyPermission: ["menu.view"] },
  { href: "/app/inventory", label: "Inventory", icon: Package, anyPermission: ["inventory.view"], module: "inventory" },
  { href: "/app/delivery", label: "Delivery", icon: Truck, anyPermission: ["delivery.view"], module: "delivery" },
  { href: "/app/customers", label: "Customers", icon: Users, anyPermission: ["crm.view"], module: "crm" },
  { href: "/app/expenses", label: "Expenses", icon: Receipt, anyPermission: ["finance.expense.create"], module: "finance" },
  { href: "/app/branches", label: "Branches", icon: Building2, anyPermission: ["branch.manage"] },
  { href: "/app/staff", label: "Staff", icon: UserPlus, anyPermission: ["staff.manage", "staff.invite"] },
  { href: "/app/whatsapp", label: "WhatsApp", icon: MessageCircle, anyPermission: ["whatsapp.manage"], module: "whatsapp" },
  {
    href: "/app/online-ordering",
    label: "Online Ordering",
    icon: Globe,
    anyPermission: ["settings.general.manage"],
    module: "online",
  },
  {
    href: "/app/reports",
    label: "Reports",
    icon: BarChart3,
    anyPermission: [
      "reports.sales.view",
      "reports.discountVoid.view",
      "reports.inventoryValuation.view",
      "reports.riderPerformance.view",
      "reports.staff.view",
      "costing.viewMargins",
    ],
  },
  {
    href: "/app/hr",
    label: "HR & Payroll",
    icon: Wallet,
    anyPermission: ["hr.shift.assign", "hr.attendance.edit", "hr.employee.manage", "hr.payroll.run", "hr.payroll.view"],
    module: "hr",
  },
  { href: "/app/sync-conflicts", label: "Sync Conflicts", icon: RefreshCw, anyPermission: ["sync.conflict.resolve"] },
];

export function AppSidebarNav({
  permissions,
  enabledModules,
  kdsEnabled,
}: {
  permissions: string[];
  enabledModules: string[];
  /** Per-branch operational toggle (BranchSettings.kdsEnabled), not a subscription-tier module —
   * see getBranchKdsEnabled in src/server/branch-settings.ts. Only affects the "/kds" item. */
  kdsEnabled: boolean;
}) {
  const pathname = usePathname();

  const visible = NAV.filter((item) => {
    if (item.anyPermission && !item.anyPermission.some((p) => permissions.includes(p))) return false;
    if (item.module && !enabledModules.includes(item.module)) return false;
    if (item.href === "/kds" && !kdsEnabled) return false;
    return true;
  });

  // min-h-0 is required for overflow-y-auto to work here: a flex item defaults to
  // min-height:auto, which refuses to shrink below its content and defeats the scroll.
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      {visible.map((item) => {
        // Exact match for /app/dashboard (it's also a prefix of nothing else), startsWith for
        // everything nested under a section (e.g. /app/inventory/recipes should still light up
        // "Inventory"). /pos and /kds are separate full-screen routes, never active from in here.
        const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-sidebar-accent text-sidebar-foreground"
                : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            }`}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
