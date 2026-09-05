import Link from "next/link";
import { subDays } from "date-fns";
import { ArrowRight, BarChart3, ChefHat, ShieldCheck, TrendingDown, TrendingUp, UtensilsCrossed } from "lucide-react";
import { auth } from "@/server/auth";
import { resolveReportBranchIds, salesReport } from "@/server/reports";
import type { TenantSessionUser } from "@/server/auth/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AreaTrendChart } from "@/components/charts/area-trend-chart";
import { LowStockBanner } from "@/components/dashboard/low-stock-banner";
import { CancellationBanner } from "@/components/dashboard/cancellation-banner";
import { getBranchKdsEnabled } from "@/server/branch-settings";
import { formatPkr } from "@/lib/money";

const QUICK_ACTIONS = [
  { href: "/pos", icon: UtensilsCrossed, title: "Point of Sale", description: "Punch orders, take payments, manage the floor.", cta: "Open POS", primary: true },
  { href: "/kds", icon: ChefHat, title: "Kitchen Display", description: "Live order tickets for the kitchen.", cta: "Open KDS", primary: false },
  { href: "/app/reports", icon: BarChart3, title: "Reports", description: "Sales summary and item-wise performance.", cta: "View reports", primary: false },
];

// Fetched straight from the report module (not through /api/reports/sales-summary) — this is a
// Server Component, so there's no reason to round-trip through our own HTTP API for data we can
// call directly; the client-only AreaTrendChart is still rendered client-side, just fed via props.
async function RevenueTrendCard({ user }: { user: TenantSessionUser }) {
  const branchIds = await resolveReportBranchIds(user, undefined);
  const to = new Date();
  const from = subDays(to, 7);
  const report = await salesReport(user.tenantId, branchIds, { from, to });
  const trend = report.previousPeriod.changePct;

  return (
    <Card className="relative overflow-hidden shadow-lg ring-1 ring-primary/10 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-gradient-to-r before:from-primary before:via-primary/60 before:to-transparent">
      <CardHeader className="flex flex-row items-center justify-between bg-gradient-to-b from-primary/[0.07] to-transparent">
        <div>
          <CardTitle className="font-heading">Revenue, last 7 days</CardTitle>
          <CardDescription>vs. the 7 days before</CardDescription>
        </div>
        <div className="text-right">
          <div className="font-heading text-3xl font-bold tabular-nums text-primary">{formatPkr(report.totalPaisa)}</div>
          {trend !== null && (
            <div
              className={`mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold ${trend >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}
            >
              {trend >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
              {trend >= 0 ? "+" : ""}
              {trend.toFixed(1)}%
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <AreaTrendChart
          data={report.byDay}
          xKey="day"
          yKey="totalPaisa"
          height={160}
        />
      </CardContent>
    </Card>
  );
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
          <RevenueTrendCard user={user} />
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
