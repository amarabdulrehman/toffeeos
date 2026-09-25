-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "taxExemptById" TEXT,
ADD COLUMN     "taxExemptReason" TEXT;

-- CreateTable
CREATE TABLE "NoSaleOpening" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoSaleOpening_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoSaleOpening_tenantId_branchId_createdAt_idx" ON "NoSaleOpening"("tenantId", "branchId", "createdAt");

-- RLS for NoSaleOpening, the same template as Refund and CashDrawerDay: FORCE so even the table
-- owner cannot bypass it, and current_setting(..., true) so an unset app.tenant_id yields NULL and
-- the policy fails closed. A record of when a till was opened is one tenant's business alone.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "NoSaleOpening" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "NoSaleOpening" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "NoSaleOpening" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';
END
$$;

-- An exemption always carries its reason; a reason with nobody behind it is not an exemption.
ALTER TABLE "Order" ADD CONSTRAINT "Order_taxExempt_has_actor"
  CHECK (("taxExemptReason" IS NULL) = ("taxExemptById" IS NULL));
