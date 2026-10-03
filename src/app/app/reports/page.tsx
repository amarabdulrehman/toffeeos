import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getTenantModulesForTenant } from "@/server/tier";
import { ReportsView } from "@/components/reports/reports-view";
import { tenantDb } from "@/server/db";

// Individual tabs each require their own narrower permission (checked server-side by their own
// API route — see src/app/api/reports/*/route.ts) since a role can reasonably see some report
// types but not others (e.g. a kitchen manager might have costing.viewMargins but not
// reports.staff.view). This page-level gate only keeps someone with none of them off the page
// entirely, matching how every other protected page (Dashboard, POS, KDS) redirects rather than
// rendering a page that has nothing to show.
const REPORTS_PERMISSIONS = [
  "reports.sales.view",
  "reports.discountVoid.view",
  "reports.cancellation.view",
  "reports.inventoryValuation.view",
  "reports.riderPerformance.view",
  "reports.staff.view",
  "costing.viewMargins",
  // Not a reports.* key, but the P&L tab lives on this page — without it here, a role granted only
  // finance.pnl.view would be redirected off the one page that renders it.
  "finance.pnl.view",
];

export default async function ReportsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!REPORTS_PERMISSIONS.some((p) => user.permissions.includes(p))) redirect("/app/dashboard");

  // Sales/staff reports stay always-on; the rest of the tabs each need their own module toggle —
  // ReportsView hides the ones the tenant doesn't have enabled rather than the page redirecting
  // wholesale, since most tenants can see *some* of this page regardless.
  const enabledModules = await getTenantModulesForTenant(user.tenantId);

  // Deleting orders: the owner, on a restaurant the platform has switched it on for, and not while a
  // platform admin is signed in as them. The server checks all of it again, plus the password.
  const isOwner = user.roleKey === "owner" && !user.impersonatedByPlatformUserId;
  const canDeleteOrders = isOwner && enabledModules.includes("orderDelete");
  // The log stays visible if the feature is later switched off — the record outlives the switch.
  const showDeletionLog =
    isOwner && (canDeleteOrders || (await tenantDb(user.tenantId).orderDeletion.count()) > 0);

  return (
    <ReportsView
      enabledModules={enabledModules}
      canExport={user.permissions.includes("reports.export")}
      canDeleteOrders={canDeleteOrders}
      showDeletionLog={showDeletionLog}
    />
  );
}
