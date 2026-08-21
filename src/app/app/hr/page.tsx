import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getTenantTier, tierMeets } from "@/server/tier";
import { UpgradeRequired } from "@/components/tier/upgrade-required";
import { HrView } from "@/components/hr/hr-view";

// Same broad "has some HR capability" gate as Reports — the 4 tabs each need their own narrower
// permission (checked server-side by their own API routes), but a role with none of them has
// nothing to see on this page at all. Payroll/pay-rate data is sensitive, so this gate matters
// more here than on most other back-office pages.
const HR_PERMISSIONS = [
  "hr.shift.assign",
  "hr.attendance.edit",
  "hr.employee.manage",
  "hr.payroll.run",
  "hr.payroll.view",
];

export default async function HrPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!HR_PERMISSIONS.some((p) => user.permissions.includes(p))) redirect("/app/dashboard");

  const tier = await getTenantTier(tenantDb(user.tenantId));
  if (!tierMeets(tier, "complete")) {
    return <UpgradeRequired feature="Payroll & HR" requiredTier="complete" />;
  }

  return <HrView />;
}
