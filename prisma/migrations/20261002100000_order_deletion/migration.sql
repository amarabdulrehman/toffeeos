-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'DELETED';

-- CreateTable
CREATE TABLE "OrderDeletion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" INTEGER NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "previousStatus" "OrderStatus" NOT NULL,
    "totalPaisa" INTEGER NOT NULL,
    "paidPaisa" INTEGER NOT NULL,
    "refundedPaisa" INTEGER NOT NULL,
    "payments" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "orderCreatedAt" TIMESTAMP(3) NOT NULL,
    "orderPaidAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "restocked" BOOLEAN NOT NULL,
    "deletedById" TEXT NOT NULL,
    "deletedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderDeletion_orderId_key" ON "OrderDeletion"("orderId");

-- CreateIndex
CREATE INDEX "OrderDeletion_tenantId_branchId_createdAt_idx" ON "OrderDeletion"("tenantId", "branchId", "createdAt");


-- Tenant isolation, same template as every other tenant table: FORCE so even the table owner
-- can't bypass, and current_setting(..., true) so an unset app.tenant_id fails closed.
ALTER TABLE "OrderDeletion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderDeletion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrderDeletion"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Append-only for the app. Default privileges gave app_user UPDATE and DELETE on every new table;
-- for this one they are taken back, so no code path in the app can rewrite or erase the record of
-- a deletion. platform_user keeps them only so deleting a whole restaurant can still sweep it.
REVOKE UPDATE, DELETE, TRUNCATE ON "OrderDeletion" FROM app_user;
