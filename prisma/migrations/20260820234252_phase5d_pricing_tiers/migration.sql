-- AlterTable
ALTER TABLE "Plan" ALTER COLUMN "maxBranches" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Subscription" ALTER COLUMN "branchLimit" DROP NOT NULL;

-- Data fixup for Phase D's tier rename: "enterprise" -> "complete" (same row, so every existing
-- Subscription pointing at it just sees the new name/key), and Growth's branch cap 5 -> 3 per the
-- new pricing brief. Any Subscription already snapshotted at the old branchLimit is refreshed to
-- match its plan's current maxBranches, and Complete's is set to NULL (unlimited).
UPDATE "Plan" SET "key" = 'complete', "name" = 'Complete', "maxBranches" = NULL WHERE "key" = 'enterprise';
UPDATE "Plan" SET "maxBranches" = 3 WHERE "key" = 'growth';

UPDATE "Subscription" s
SET "branchLimit" = p."maxBranches"
FROM "Plan" p
WHERE s."planId" = p."id";
