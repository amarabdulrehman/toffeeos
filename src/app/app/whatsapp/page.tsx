import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getTenantTier, tierMeets } from "@/server/tier";
import { UpgradeRequired } from "@/components/tier/upgrade-required";
import { WhatsAppView } from "@/components/whatsapp/whatsapp-view";

export default async function WhatsAppPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("whatsapp.manage")) redirect("/app/dashboard");

  const tier = await getTenantTier(tenantDb(user.tenantId));
  if (!tierMeets(tier, "complete")) {
    return <UpgradeRequired feature="WhatsApp Business Messaging" requiredTier="complete" />;
  }

  return <WhatsAppView />;
}
