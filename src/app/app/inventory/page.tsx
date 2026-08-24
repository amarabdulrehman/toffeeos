import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getTenantModulesForTenant } from "@/server/tier";
import { UpgradeRequired } from "@/components/tier/upgrade-required";
import { InventoryView } from "@/components/inventory/inventory-view";

export default async function InventoryPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("inventory.view")) redirect("/app/dashboard");

  const enabledModules = await getTenantModulesForTenant(user.tenantId);
  if (!enabledModules.includes("inventory")) {
    return <UpgradeRequired feature="Inventory & Stock Control" requiredTier="growth" />;
  }

  return <InventoryView />;
}
