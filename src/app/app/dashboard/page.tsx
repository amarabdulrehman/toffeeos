import Link from "next/link";
import { ArrowRight, BarChart3, ChefHat, ShieldCheck, UtensilsCrossed } from "lucide-react";
import { dayReport } from "@/server/daily-sales";
import { auth } from "@/server/auth";
import { resolveReportBranchIds } from "@/server/reports";
import type { TenantSessionUser } from "@/server/auth/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LowStockBanner } from "@/components/dashboard/low-stock-banner";
import { CancellationBanner } from "@/components/dashboard/cancellation-banner";
import { SalesOverview } from "@/components/dashboard/sales-overview";
import { getBranchKdsEnabled } from "@/server/branch-settings";

const QUICK_ACTIONS = [
  { href: "/pos", icon: UtensilsCrossed, title: "Point of Sale", description: "Punch orders, take payments, manage the floor.", cta: "Open POS", primary: true },
  { href: "/kds", icon: ChefHat, title: "Kitchen Display", description: "Live order tickets for the kitchen.", cta: "Open KDS", primary: false },
  { href: "/app/reports", icon: BarChart3, title: "Reports", description: "Sales summary and item-wise performance.", cta: "View reports", primary: false },
];

/**
 * Today's figures come with the page, so the card is never a spinner on arrival; the other periods
 * load in the browser when picked. The same report Daily Sales uses, so the two always agree.
 */
async function SalesSection({ user }: { user: TenantSessionUser }) {
  const branchIds = await resolveReportBranchIds(user, undefined);
  const today = await dayReport(user.tenantId, branchIds);
  return <SalesOverview initial={today} />;
}

export default async function DashboardPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") return null;
  const canViewSales = user.permissions.includes("reports.sales.view");
  const canViewInventory = user.permissions.includes("inventory.view");
  const canReviewCancellations = user.permissions.includes("reports.cancellation.view");
  const kdsEnabled = await getBranchKdsEnabled(user.tenantId, user.branchId);
  const quickActions = QUICK_ACTIONS.filter((a) => a.href !== "/kds" || kdsEnabled);

  return (
    <div className="p-8">
      <h1 className="font-heading text-[1.75rem] font-bold tracking-tight">Welcome back, {user.name.split(" ")[0]}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{user.tenantName} · {user.branchName}</p>

      {canViewInventory && <LowStockBanner />}
      {canReviewCancellations && <CancellationBanner />}

      {canViewSales && (
        <div className="mt-8">
          <SalesSection user={user} />
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {quickActions.map((action) => (
          <Card
            key={action.href}
            className="group shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
          >
            <CardHeader>
              <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary ring-4 ring-primary/5 transition-colors group-hover:bg-primary/15">
                <action.icon className="size-5" />
              </div>
              <CardTitle className="font-heading">{action.title}</CardTitle>
              <CardDescription>{action.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                render={<Link href={action.href} />}
                nativeButton={false}
                variant={action.primary ? "default" : "outline"}
                className="group/btn"
              >
                {action.cta}
                <ArrowRight className="size-4 transition-transform group-hover/btn:translate-x-0.5" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 flex items-center gap-2.5 rounded-xl border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0" />
        {user.permissions.length} permissions granted · role: <span className="font-medium text-foreground">{user.roleKey.replace("_", " ")}</span>
      </div>
    </div>
  );
}
