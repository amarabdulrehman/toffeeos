import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getTenantModulesForTenant } from "@/server/tier";
import { UpgradeRequired } from "@/components/tier/upgrade-required";
import { ExpensesView } from "@/components/expenses/expenses-view";

export default async function ExpensesPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  // There's no separate finance view permission in the registry — create is the gate for both
  // reading and writing, matching the API routes.
  if (!user.permissions.includes("finance.expense.create")) redirect("/app/dashboard");

  const enabledModules = await getTenantModulesForTenant(user.tenantId);
  if (!enabledModules.includes("finance")) {
    return <UpgradeRequired feature="Expense Tracking" requiredTier="growth" />;
  }

  return <ExpensesView />;
}
