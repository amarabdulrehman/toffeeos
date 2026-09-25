import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { reportClock, resolveReportBranchIds } from "@/server/reports";
import { todayFor } from "@/lib/business-day";
import { getBranchClock } from "@/server/branch-settings";
import { DailySalesView, type SalesScope } from "@/components/sales/daily-sales-view";

// The same permission as the Sales report: these are the same figures, a day at a time. Owners and
// managers hold it; cashiers and waiters do not.
export default async function DailySalesPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("reports.sales.view")) redirect("/app/dashboard");

  const branchIds = await resolveReportBranchIds(user, undefined);
  const branches = await tenantDb(user.tenantId).branch.findMany({
    where: { id: { in: branchIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const now = new Date();

  // The first choice is everything this person may see, on the same clock the reports use.
  const clock = await reportClock(user.tenantId, branchIds);
  const scopes: SalesScope[] = [
    {
      branchId: null,
      label: branches.length > 1 ? `All ${branches.length} branches` : (branches[0]?.name ?? user.branchName),
      today: todayFor(clock.timezone, now, clock.dayStartMinutes),
      dayStartMinutes: clock.dayStartMinutes,
    },
  ];
  // Then each branch on its own, for an owner with more than one — each on its own clock, since
  // one may trade until 2am and another close at 11.
  if (branches.length > 1) {
    for (const b of branches) {
      const own = await getBranchClock(user.tenantId, b.id);
      scopes.push({
        branchId: b.id,
        label: b.name,
        today: todayFor(own.timezone, now, own.dayStartMinutes),
        dayStartMinutes: own.dayStartMinutes,
      });
    }
  }

  return <DailySalesView scopes={scopes} tenantName={user.tenantName} canExport={user.permissions.includes("reports.export")} />;
}
