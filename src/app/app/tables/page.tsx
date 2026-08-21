import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getTenantTier, tierMeets } from "@/server/tier";
import { TablesSettingsView } from "@/components/tables/tables-settings-view";

// Tables & Floors itself is available at every tier — only the QR-ordering button within it is
// Complete-only, hidden via the qrOrderingEnabled prop rather than gating the whole page.
export default async function TablesSettingsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("tables.manage")) redirect("/app/dashboard");

  const tier = await getTenantTier(tenantDb(user.tenantId));
  return <TablesSettingsView qrOrderingEnabled={tierMeets(tier, "complete")} />;
}
