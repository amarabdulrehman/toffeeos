import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getTenantModulesForTenant } from "@/server/tier";
import { UpgradeRequired } from "@/components/tier/upgrade-required";
import { CustomersView } from "@/components/crm/customers-view";

export default async function CustomersPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("crm.view")) redirect("/app/dashboard");

  const enabledModules = await getTenantModulesForTenant(user.tenantId);
  if (!enabledModules.includes("crm")) {
    return <UpgradeRequired feature="CRM" requiredTier="growth" />;
  }

  return (
    <CustomersView
      canSetUpLoyalty={user.permissions.includes("settings.general.manage")}
      canAdjustPoints={user.permissions.includes("crm.loyalty.adjust")}
    />
  );
}
