import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getTenantSubscriptionInfo } from "@/server/tier";
import { BranchesView } from "@/components/branches/branches-view";

export default async function BranchesPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("branch.manage")) redirect("/app/dashboard");

  const info = await getTenantSubscriptionInfo(tenantDb(user.tenantId));

  return (
    <BranchesView
      planName={info?.planName ?? "Starter"}
      maxBranches={info?.maxBranches ?? 1}
      canManageServiceCharge={user.permissions.includes("settings.serviceCharge.manage")}
    />
  );
}
