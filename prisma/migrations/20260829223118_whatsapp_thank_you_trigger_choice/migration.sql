-- CreateEnum
CREATE TYPE "ThankYouTrigger" AS ENUM ('ON_ORDER', 'ON_PAYMENT');

-- AlterTable
ALTER TABLE "WhatsAppSettings" ADD COLUMN     "thankYouTrigger" "ThankYouTrigger" NOT NULL DEFAULT 'ON_PAYMENT';
