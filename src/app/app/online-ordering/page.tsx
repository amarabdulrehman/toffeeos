import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getTenantModulesForTenant } from "@/server/tier";
import { UpgradeRequired } from "@/components/tier/upgrade-required";
import { OnlineOrderingView } from "@/components/online-ordering/online-ordering-view";

export default async function OnlineOrderingPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("settings.general.manage")) redirect("/app/dashboard");

  const enabledModules = await getTenantModulesForTenant(user.tenantId);
  if (!enabledModules.includes("online")) {
    return <UpgradeRequired feature="Online Ordering & QR Table Ordering" requiredTier="complete" />;
  }

  return <OnlineOrderingView canManageOnlineMenu={user.permissions.includes("online.menu.manage")} />;
}
