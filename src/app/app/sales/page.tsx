import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { reportClock, resolveReportBranchIds } from "@/server/reports";
import { todayFor } from "@/lib/business-day";
import { DailySalesView } from "@/components/sales/daily-sales-view";

// The same permission as the Sales report: these are the same figures, a day at a time. Owners and
// managers hold it; cashiers and waiters do not.
export default async function DailySalesPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("reports.sales.view")) redirect("/app/dashboard");

  const branchIds = await resolveReportBranchIds(user, undefined);
  const clock = await reportClock(user.tenantId, branchIds);
  let scopeLabel = user.branchName;
  if (branchIds.length > 1) {
    scopeLabel = `All ${branchIds.length} branches`;
  } else if (branchIds[0] && branchIds[0] !== user.branchId) {
    const branch = await tenantDb(user.tenantId).branch.findUnique({ where: { id: branchIds[0] }, select: { name: true } });
    scopeLabel = branch?.name ?? scopeLabel;
  }

  return (
    <DailySalesView
      today={todayFor(clock.timezone, new Date(), clock.dayStartMinutes)}
      dayStartMinutes={clock.dayStartMinutes}
      tenantName={user.tenantName}
      scopeLabel={scopeLabel}
    />
  );
}
