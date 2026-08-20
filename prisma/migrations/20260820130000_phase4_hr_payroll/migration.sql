-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('HOURLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('PIN', 'MANUAL');

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "hourlyRatePaisa" INTEGER,
ADD COLUMN     "monthlySalaryPaisa" INTEGER,
ADD COLUMN     "payType" "PayType";

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clockInAt" TIMESTAMP(3) NOT NULL,
    "clockOutAt" TIMESTAMP(3),
    "source" "AttendanceSource" NOT NULL DEFAULT 'PIN',
    "editedById" TEXT,
    "editNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shift_tenantId_branchId_startsAt_idx" ON "Shift"("tenantId", "branchId", "startsAt");

-- CreateIndex
CREATE INDEX "Shift_tenantId_userId_idx" ON "Shift"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "AttendanceRecord_tenantId_branchId_clockInAt_idx" ON "AttendanceRecord"("tenantId", "branchId", "clockInAt");

-- CreateIndex
CREATE INDEX "AttendanceRecord_tenantId_userId_idx" ON "AttendanceRecord"("tenantId", "userId");

