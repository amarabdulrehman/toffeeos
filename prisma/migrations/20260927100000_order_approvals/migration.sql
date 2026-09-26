-- CreateEnum
CREATE TYPE "OrderApprovalKind" AS ENUM ('NEW_ORDER', 'MORE_ITEMS');

-- CreateEnum
CREATE TYPE "OrderApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "BranchSettings" ADD COLUMN     "waiterOrdersNeedApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OrderApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "OrderApprovalKind" NOT NULL,
    "lines" JSONB,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "OrderApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,

    CONSTRAINT "OrderApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderApproval_tenantId_branchId_status_idx" ON "OrderApproval"("tenantId", "branchId", "status");

-- CreateIndex
CREATE INDEX "OrderApproval_orderId_idx" ON "OrderApproval"("orderId");


-- At most one new-order request waiting per order: a send retried from a flaky connection, or
-- replayed from the offline queue, finds the one already there rather than asking twice.
CREATE UNIQUE INDEX "OrderApproval_one_pending_new_order" ON "OrderApproval"("orderId")
  WHERE "kind" = 'NEW_ORDER' AND "status" = 'PENDING';

-- A decision always says who made it and when; a rejection always says why.
ALTER TABLE "OrderApproval" ADD CONSTRAINT "OrderApproval_decided_has_actor"
  CHECK (("status" = 'PENDING') = ("decidedAt" IS NULL) AND ("decidedAt" IS NULL) = ("decidedById" IS NULL));
ALTER TABLE "OrderApproval" ADD CONSTRAINT "OrderApproval_rejected_has_reason"
  CHECK ("status" <> 'REJECTED' OR "rejectReason" IS NOT NULL);

-- RLS for OrderApproval, the same template as NoSaleOpening: FORCE so even the table owner cannot
-- bypass it, and current_setting(..., true) so an unset app.tenant_id yields NULL and the policy
-- fails closed.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "OrderApproval" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "OrderApproval" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "OrderApproval" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';
END
$$;
