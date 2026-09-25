import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getTenantModulesForTenant } from "@/server/tier";
import { TablesSettingsView } from "@/components/tables/tables-settings-view";

// Tables & Floors itself is available at every tier — only the QR-ordering button within it needs
// the Online Ordering module (Complete's default), hidden via the qrOrderingEnabled prop rather
// than gating the whole page.
export default async function TablesSettingsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("tables.manage")) redirect("/app/dashboard");

  const enabledModules = await getTenantModulesForTenant(user.tenantId);
  // QR codes need both the module and online.qr.manage: printing one puts ordering on a table.
  return (
    <TablesSettingsView
      qrOrderingEnabled={enabledModules.includes("online") && user.permissions.includes("online.qr.manage")}
    />
  );
}
