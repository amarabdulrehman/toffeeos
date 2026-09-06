-- CreateTable
CREATE TABLE "CashDrawerDay" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "openingBalancePaisa" INTEGER NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closingCountedPaisa" INTEGER,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashDrawerDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashDrawerDay_tenantId_branchId_businessDate_idx" ON "CashDrawerDay"("tenantId", "branchId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "CashDrawerDay_branchId_businessDate_key" ON "CashDrawerDay"("branchId", "businessDate");
