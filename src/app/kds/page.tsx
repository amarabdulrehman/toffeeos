import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { KdsBoard } from "@/components/kds/kds-board";

export default async function KdsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("kds.access")) redirect("/app/dashboard");

  return (
    <KdsBoard
      tenantId={user.tenantId}
      branchId={user.branchId}
      branchName={user.branchName}
      canMarkReady={user.permissions.includes("kds.item.markReady")}
      canRecall={user.permissions.includes("kds.order.recall")}
    />
  );
}
