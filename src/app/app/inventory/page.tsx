import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getTenantTier, tierMeets } from "@/server/tier";
import { UpgradeRequired } from "@/components/tier/upgrade-required";
import { InventoryView } from "@/components/inventory/inventory-view";

export default async function InventoryPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("inventory.view")) redirect("/app/dashboard");

  const tier = await getTenantTier(tenantDb(user.tenantId));
  if (!tierMeets(tier, "growth")) {
    return <UpgradeRequired feature="Inventory & Stock Control" requiredTier="growth" />;
  }

  return <InventoryView />;
}
