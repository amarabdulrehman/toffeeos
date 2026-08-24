import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getTenantModulesForTenant } from "@/server/tier";
import { MenuView } from "@/components/menu/menu-view";

export default async function MenuManagementPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("menu.view")) redirect("/app/dashboard");

  // Menu itself is always available (core), but Recipe & Costing is its own toggle — the recipe
  // editor is hidden rather than shown-and-403ing, same as every other gated feature in the nav.
  const enabledModules = await getTenantModulesForTenant(user.tenantId);

  return <MenuView recipeEnabled={enabledModules.includes("recipe")} />;
}
