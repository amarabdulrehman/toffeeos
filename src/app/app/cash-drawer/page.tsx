import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { CashDrawerView } from "@/components/cash-drawer/cash-drawer-view";

// Not tier-gated. Counting the till is not an upsell — a one-branch restaurant on the cheapest
// plan needs it more than a chain does, and the pos.* permission group has no module entry in
// MODULE_MIN_TIER precisely because POS is the product's floor, not an add-on.
export default async function CashDrawerPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("pos.shift.open")) redirect("/app/dashboard");

  return <CashDrawerView canClose={user.permissions.includes("pos.shift.close")} />;
}
