-- New branches' business day ends at 3am rather than midnight.
--
-- Only the column default changes, so only rows created from now on are affected. Existing branches
-- keep their setting: moving theirs would re-file past after-midnight sales onto different days
-- without anyone having asked for it.
ALTER TABLE "BranchSettings" ALTER COLUMN "dayStartMinutes" SET DEFAULT 180;
