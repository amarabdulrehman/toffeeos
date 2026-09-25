import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getTenantModulesForTenant } from "@/server/tier";
import { UpgradeRequired } from "@/components/tier/upgrade-required";
import { DeliveryView } from "@/components/delivery/delivery-view";

export default async function DeliveryPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("delivery.view")) redirect("/app/dashboard");

  const enabledModules = await getTenantModulesForTenant(user.tenantId);
  if (!enabledModules.includes("delivery")) {
    return <UpgradeRequired feature="Delivery & Rider Management" requiredTier="complete" />;
  }

  return <DeliveryView canSettleCash={user.permissions.includes("orders.markPaid")} />;
}
