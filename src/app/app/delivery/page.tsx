import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getTenantTier, tierMeets } from "@/server/tier";
import { UpgradeRequired } from "@/components/tier/upgrade-required";
import { DeliveryView } from "@/components/delivery/delivery-view";

export default async function DeliveryPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("delivery.view")) redirect("/app/dashboard");

  const tier = await getTenantTier(tenantDb(user.tenantId));
  if (!tierMeets(tier, "complete")) {
    return <UpgradeRequired feature="Delivery & Rider Management" requiredTier="complete" />;
  }

  return <DeliveryView />;
}
