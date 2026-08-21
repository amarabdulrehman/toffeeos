import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getTenantTier, tierMeets } from "@/server/tier";
import { UpgradeRequired } from "@/components/tier/upgrade-required";
import { OnlineOrderingView } from "@/components/online-ordering/online-ordering-view";

export default async function OnlineOrderingPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("settings.general.manage")) redirect("/app/dashboard");

  const tier = await getTenantTier(tenantDb(user.tenantId));
  if (!tierMeets(tier, "complete")) {
    return <UpgradeRequired feature="Online Ordering & QR Table Ordering" requiredTier="complete" />;
  }

  return <OnlineOrderingView />;
}
