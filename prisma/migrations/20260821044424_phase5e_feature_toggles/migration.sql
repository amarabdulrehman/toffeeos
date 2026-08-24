-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "enabledModules" TEXT[] DEFAULT ARRAY[]::TEXT[];
