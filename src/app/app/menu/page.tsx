import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getTenantTier, tierMeets } from "@/server/tier";
import { MenuView } from "@/components/menu/menu-view";

export default async function MenuManagementPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("menu.view")) redirect("/app/dashboard");

  // Menu itself is Starter+ (core), but Recipe & Costing is Growth+ — the recipe editor is hidden
  // rather than shown-and-403ing, same as every other tier-locked feature in the nav.
  const tier = await getTenantTier(tenantDb(user.tenantId));

  return <MenuView recipeEnabled={tierMeets(tier, "growth")} />;
}
