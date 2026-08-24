import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getTenantModulesForTenant } from "@/server/tier";
import { UpgradeRequired } from "@/components/tier/upgrade-required";
import { WhatsAppView } from "@/components/whatsapp/whatsapp-view";

export default async function WhatsAppPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("whatsapp.manage")) redirect("/app/dashboard");

  const enabledModules = await getTenantModulesForTenant(user.tenantId);
  if (!enabledModules.includes("whatsapp")) {
    return <UpgradeRequired feature="WhatsApp Business Messaging" requiredTier="complete" />;
  }

  return <WhatsAppView />;
}
