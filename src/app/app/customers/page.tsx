import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getTenantTier, tierMeets } from "@/server/tier";
import { UpgradeRequired } from "@/components/tier/upgrade-required";
import { CustomersView } from "@/components/crm/customers-view";

export default async function CustomersPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("crm.view")) redirect("/app/dashboard");

  const tier = await getTenantTier(tenantDb(user.tenantId));
  if (!tierMeets(tier, "growth")) {
    return <UpgradeRequired feature="CRM" requiredTier="growth" />;
  }

  return <CustomersView />;
}
