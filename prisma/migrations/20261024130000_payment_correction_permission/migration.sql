-- Correcting how a paid bill was paid (src/server/paid-order-edits.ts) is gated for the first time,
-- so it reaches the standard roles in every restaurant that already exists, as migration
-- 20260925101500 did. Additive and idempotent, system roles only; a role an owner customised is
-- left alone. Cashiers fix their own slips the same day; an earlier or counted day also needs
-- pos.cashDrawer.correctClose, which they don't hold.
UPDATE "Role"
SET permissions = array_append(permissions, 'pos.payment.correct')
WHERE key IN ('owner', 'branch_manager', 'cashier') AND "isSystem" = true
  AND NOT ('pos.payment.correct' = ANY(permissions));
