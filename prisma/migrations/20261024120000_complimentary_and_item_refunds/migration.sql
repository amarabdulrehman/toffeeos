-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "compReason" TEXT,
ADD COLUMN     "compValuePaisa" INTEGER,
ADD COLUMN     "compedAt" TIMESTAMP(3),
ADD COLUMN     "compedById" TEXT,
ADD COLUMN     "isComplimentary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "refundedQuantity" INTEGER NOT NULL DEFAULT 0;


-- Item refunds can't take back more of a line than was sold.
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_refundedQuantity_range"
  CHECK ("refundedQuantity" >= 0 AND "refundedQuantity" <= "quantity");

-- Giving something complimentary is gated for the first time, so it reaches the standard roles
-- that should have it in every restaurant that already exists (as migration 20260925101500 did).
-- Additive and idempotent, system roles only; a role an owner customised is left alone. The owner
-- role holds every permission, the branch manager every operational one, and cashiers were asked
-- for by name.
UPDATE "Role"
SET permissions = array_append(permissions, 'pos.order.comp')
WHERE key IN ('owner', 'branch_manager', 'cashier') AND "isSystem" = true
  AND NOT ('pos.order.comp' = ANY(permissions));
