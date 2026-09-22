-- AlterEnum
ALTER TYPE "WhatsAppMessageStatus" ADD VALUE 'SKIPPED_NOT_CONFIGURED';

-- AlterTable
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN     "error" TEXT,
ADD COLUMN     "providerMessageId" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppTemplate" ADD COLUMN     "metaTemplateName" TEXT;
