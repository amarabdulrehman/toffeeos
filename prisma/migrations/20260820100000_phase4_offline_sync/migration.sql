-- CreateEnum
CREATE TYPE "SyncConflictKind" AS ENUM ('TABLE_DOUBLE_ORDER', 'STALE_ORDER_ACTION');

-- CreateEnum
CREATE TYPE "SyncConflictStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "SyncActionLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" "SyncConflictKind" NOT NULL,
    "tableId" TEXT,
    "orderId" TEXT,
    "conflictingOrderId" TEXT,
    "actionType" TEXT,
    "devicePayload" JSONB,
    "serverSnapshot" JSONB,
    "status" "SyncConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncActionLog_tenantId_orderId_idx" ON "SyncActionLog"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncActionLog_tenantId_actionId_key" ON "SyncActionLog"("tenantId", "actionId");

-- CreateIndex
CREATE INDEX "SyncConflict_tenantId_branchId_status_idx" ON "SyncConflict"("tenantId", "branchId", "status");
