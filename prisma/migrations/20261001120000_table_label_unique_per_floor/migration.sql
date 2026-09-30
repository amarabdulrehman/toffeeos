-- Table labels are unique per floor, not per branch.
--
-- Numbering tables 1-10 on the ground floor and 1-10 upstairs is ordinary, but the branch-wide
-- index rejected the second floor's first table. Because the duplicate-key error was not handled
-- anywhere, it reached the client as "Internal error", which read as a mystery cap on the number
-- of tables a floor could take.
--
-- This only relaxes the constraint, so it cannot fail on existing rows: a floor belongs to exactly
-- one branch, so anything unique across a branch is already unique within a floor.
DROP INDEX IF EXISTS "RestaurantTable_branchId_label_key";
CREATE UNIQUE INDEX "RestaurantTable_floorId_label_key" ON "RestaurantTable"("floorId", "label");
