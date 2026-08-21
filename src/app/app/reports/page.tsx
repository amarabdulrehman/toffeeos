import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getTenantTier } from "@/server/tier";
import { ReportsView } from "@/components/reports/reports-view";

// Individual tabs each require their own narrower permission (checked server-side by their own
// API route — see src/app/api/reports/*/route.ts) since a role can reasonably see some report
// types but not others (e.g. a kitchen manager might have costing.viewMargins but not
// reports.staff.view). This page-level gate only keeps someone with none of them off the page
// entirely, matching how every other protected page (Dashboard, POS, KDS) redirects rather than
// rendering a page that has nothing to show.
const REPORTS_PERMISSIONS = [
  "reports.sales.view",
  "reports.discountVoid.view",
  "reports.inventoryValuation.view",
  "reports.riderPerformance.view",
  "reports.staff.view",
  "costing.viewMargins",
];

export default async function ReportsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!REPORTS_PERMISSIONS.some((p) => user.permissions.includes(p))) redirect("/app/dashboard");

  // Sales/staff reports stay Starter; the rest of the tabs are Growth/Complete — ReportsView hides
  // the ones the tenant's plan doesn't include rather than the page redirecting wholesale, since
  // most tenants can see *some* of this page regardless of tier.
  const tier = await getTenantTier(tenantDb(user.tenantId));

  return <ReportsView tier={tier} />;
}
