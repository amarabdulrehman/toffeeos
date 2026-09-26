import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { PosTerminal } from "@/components/pos/pos-terminal";
import {
  DEFAULT_BRANCH_PRICING,
  type BranchPricingSnapshot,
  type PaymentMethodKey,
} from "@/lib/pricing";

export default async function PosPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("pos.access")) redirect("/app/dashboard");

  // Receipt branding and the pricing snapshot. Read here, server-side, rather than fetched by the
  // terminal: the POS is used offline (see src/lib/offline), and a receipt must still print with the
  // right letterhead — and a cart must still total correctly — when there is no network to go and
  // ask. The snapshot rides along with the page HTML, which the service worker caches, so a tablet
  // that has opened the till once can price orders through an outage.
  const db = tenantDb(user.tenantId);
  const [tenant, settings, taxRules] = await Promise.all([
    db.tenant.findUnique({ where: { id: user.tenantId }, select: { logoUrl: true } }),
    db.branchSettings.findUnique({
      where: { branchId: user.branchId },
      select: {
        showLogoOnReceipt: true,
        receiptHeader: true,
        serviceChargeBasisPoints: true,
        serviceChargeAppliesTo: true,
        serviceChargeTaxable: true,
        roundingMode: true,
        maxDiscountBasisPoints: true,
      },
    }),
    db.taxRule.findMany({
      where: { branchId: user.branchId, isActive: true },
      select: { paymentMethods: true, rateBasisPoints: true },
    }),
  ]);

  const pricingSnapshot: BranchPricingSnapshot = {
    serviceChargeBasisPoints: settings?.serviceChargeBasisPoints ?? DEFAULT_BRANCH_PRICING.serviceChargeBasisPoints,
    serviceChargeAppliesTo: settings?.serviceChargeAppliesTo ?? [...DEFAULT_BRANCH_PRICING.serviceChargeAppliesTo],
    serviceChargeTaxable: settings?.serviceChargeTaxable ?? DEFAULT_BRANCH_PRICING.serviceChargeTaxable,
    roundingMode: settings?.roundingMode ?? DEFAULT_BRANCH_PRICING.roundingMode,
    maxDiscountBasisPoints: settings?.maxDiscountBasisPoints ?? DEFAULT_BRANCH_PRICING.maxDiscountBasisPoints,
    taxRules: taxRules.map((r) => ({
      paymentMethods: r.paymentMethods as PaymentMethodKey[],
      rateBasisPoints: r.rateBasisPoints,
      isActive: true,
    })),
  };

  return (
    <PosTerminal
      tenantId={user.tenantId}
      branchId={user.branchId}
      userId={user.id}
      tenantName={user.tenantName}
      branchName={user.branchName}
      logoUrl={tenant?.logoUrl ?? null}
      showLogoOnReceipt={settings?.showLogoOnReceipt ?? false}
      receiptHeader={settings?.receiptHeader ?? null}
      pricingSnapshot={pricingSnapshot}
      canTakePayment={user.permissions.includes("pos.payment.take")}
      canApplyDiscount={user.permissions.includes("pos.discount.applyOrder")}
      canVoid={user.permissions.includes("pos.order.void")}
      canRefund={user.permissions.includes("pos.payment.refund")}
      canCancel={user.permissions.includes("orders.cancel")}
      canReprintReceipt={user.permissions.includes("pos.receipt.reprint")}
      canPrintKot={user.permissions.includes("pos.kot.print")}
      canReprintKot={user.permissions.includes("pos.kot.reprint")}
      canPrintBill={user.permissions.includes("pos.receipt.print")}
      managePermissions={{
        canVoidLine: user.permissions.includes("pos.order.voidLine"),
        canChangeType: user.permissions.includes("pos.order.changeType"),
        canMerge: user.permissions.includes("tables.merge"),
        canTaxExempt: user.permissions.includes("pos.tax.exempt"),
        canRedeemPoints: user.permissions.includes("pos.payment.take"),
      }}
      canNoSale={user.permissions.includes("pos.cashDrawer.openNoSale")}
    />
  );
}
