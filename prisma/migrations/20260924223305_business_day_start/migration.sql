-- AlterTable
ALTER TABLE "BranchSettings" ADD COLUMN     "dayStartMinutes" INTEGER NOT NULL DEFAULT 0;

-- Between midnight and 6am. The app refuses anything else, but the column is read by every report
-- and the cash drawer, so the database refuses it too: a stray 1440 would push every sale into the
-- previous day without a single error anywhere.
ALTER TABLE "BranchSettings" ADD CONSTRAINT "BranchSettings_dayStartMinutes_range" CHECK ("dayStartMinutes" >= 0 AND "dayStartMinutes" <= 360);
