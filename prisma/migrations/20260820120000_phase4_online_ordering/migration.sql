-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('POS', 'ONLINE', 'QR');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "brandColor" TEXT,
ADD COLUMN     "logoUrl" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "source" "OrderSource" NOT NULL DEFAULT 'POS';

