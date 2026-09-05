-- AlterTable
ALTER TABLE "BranchSettings" ADD COLUMN     "overtimeMultiplierBasisPoints" INTEGER NOT NULL DEFAULT 15000,
ADD COLUMN     "overtimeThresholdHoursPerWeek" INTEGER;

-- CreateTable
CREATE TABLE "PayrollDisbursement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "regularHours" DOUBLE PRECISION NOT NULL,
    "overtimeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossPayPaisa" INTEGER NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "paidById" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollDisbursement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollDisbursement_tenantId_branchId_idx" ON "PayrollDisbursement"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "PayrollDisbursement_tenantId_membershipId_idx" ON "PayrollDisbursement"("tenantId", "membershipId");
