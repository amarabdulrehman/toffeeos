import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { PosTerminal } from "@/components/pos/pos-terminal";

export default async function PosPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("pos.access")) redirect("/app/dashboard");

  return (
    <PosTerminal
      tenantId={user.tenantId}
      branchId={user.branchId}
      canTakePayment={user.permissions.includes("pos.payment.take")}
    />
  );
}
