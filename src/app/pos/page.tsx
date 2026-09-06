import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { PosTerminal } from "@/components/pos/pos-terminal";

export default async function PosPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("pos.access")) redirect("/app/dashboard");

  // Receipt branding. Read here, server-side, rather than fetched by the terminal: the POS is used
  // offline (see src/lib/offline), and a receipt must still print with the right letterhead when
  // there is no network to go and ask.
  const db = tenantDb(user.tenantId);
  const [tenant, settings] = await Promise.all([
    db.tenant.findUnique({ where: { id: user.tenantId }, select: { logoUrl: true } }),
    db.branchSettings.findUnique({
      where: { branchId: user.branchId },
      select: { showLogoOnReceipt: true },
    }),
  ]);

  return (
    <PosTerminal
      tenantId={user.tenantId}
      branchId={user.branchId}
      tenantName={user.tenantName}
      branchName={user.branchName}
      logoUrl={tenant?.logoUrl ?? null}
      showLogoOnReceipt={settings?.showLogoOnReceipt ?? false}
      canTakePayment={user.permissions.includes("pos.payment.take")}
      canApplyDiscount={user.permissions.includes("pos.discount.applyOrder")}
      canVoid={user.permissions.includes("pos.order.void")}
      canCancel={user.permissions.includes("orders.cancel")}
      canReprintReceipt={user.permissions.includes("pos.receipt.reprint")}
    />
  );
}
