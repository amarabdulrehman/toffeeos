-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LoyaltyTransactionKind" AS ENUM ('EARN', 'REDEEM', 'ADJUST', 'REVERSE');

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "isAvailableOnline" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "purchaseOrderId" TEXT,
ADD COLUMN     "reversalOfId" TEXT;

-- AlterTable
ALTER TABLE "OrderDiscount" ADD COLUMN     "loyaltyPointsRedeemed" INTEGER;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCostPaisa" INTEGER NOT NULL,
    "receivedQuantity" DOUBLE PRECISION,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "transferGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransferRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyProgram" (
    "tenantId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pointsPerHundredRupees" INTEGER NOT NULL DEFAULT 1,
    "paisaPerPoint" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "kind" "LoyaltyTransactionKind" NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_tenantId_idx" ON "Supplier"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_tenantId_name_key" ON "Supplier"("tenantId", "name");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_branchId_status_idx" ON "PurchaseOrder"("tenantId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_branchId_number_key" ON "PurchaseOrder"("branchId", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_tenantId_idx" ON "PurchaseOrderLine"("tenantId");

-- CreateIndex
CREATE INDEX "StockTransferRequest_tenantId_status_idx" ON "StockTransferRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_tenantId_customerId_createdAt_idx" ON "LoyaltyTransaction"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_orderId_idx" ON "LoyaltyTransaction"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_reversalOfId_key" ON "StockMovement"("reversalOfId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security for the six new tables, the same template as every tenant table: FORCE so
-- even the owner role cannot bypass it, and current_setting(..., true) so an unset app.tenant_id
-- yields NULL and the policy fails closed rather than erroring.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Supplier', 'PurchaseOrder', 'PurchaseOrderLine', 'StockTransferRequest', 'LoyaltyProgram', 'LoyaltyTransaction']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END
$$;

-- Quantities and costs that make no sense are refused by the database too, not only the API.
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_positive"
  CHECK ("quantity" > 0 AND "unitCostPaisa" >= 0 AND ("receivedQuantity" IS NULL OR "receivedQuantity" >= 0));
ALTER TABLE "StockTransferRequest" ADD CONSTRAINT "StockTransferRequest_positive" CHECK ("quantity" > 0);
ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_sane"
  CHECK ("pointsPerHundredRupees" BETWEEN 0 AND 100 AND "paisaPerPoint" BETWEEN 1 AND 100000);

-- Delivery orders paid at the till and then delivered were overwritten from PAID to DELIVERED, which
-- took them out of every sales figure (all of which count PAID). Put them back. A delivered order
-- with no payment stays DELIVERED: it is cash on delivery still to be handed in, and the Delivery
-- screen now lists it for exactly that.
UPDATE "Order" SET status = 'PAID' WHERE status = 'DELIVERED' AND "paidAt" IS NOT NULL;

-- Six permissions that could never mean anything are retired from the registry, so they come off
-- every role too. None gated anything: allergens were declined as a feature, the PIN and shift-time
-- checks they would bypass do not exist, tax is exempted (pos.tax.exempt) rather than hand-edited,
-- profit is finance.pnl.view, and plans are changed by ToffeeOS, not self-served.
UPDATE "Role" SET permissions = array_remove(permissions, 'crm.allergen.manage');
UPDATE "Role" SET permissions = array_remove(permissions, 'pos.pin.bypassVerification');
UPDATE "Role" SET permissions = array_remove(permissions, 'pos.shift.bypassTimeRestriction');
UPDATE "Role" SET permissions = array_remove(permissions, 'pos.tax.edit');
UPDATE "Role" SET permissions = array_remove(permissions, 'reports.profit.view');
UPDATE "Role" SET permissions = array_remove(permissions, 'billing.plan.change');
