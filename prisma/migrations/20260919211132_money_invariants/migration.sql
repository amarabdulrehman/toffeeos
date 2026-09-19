-- Money invariants the application already enforces, made impossible to violate.
--
-- src/server/refunds.ts refuses to refund more than was paid, and refuses a refund of zero or less.
-- That is the right place for the check, because it can explain itself to a cashier. But it is the
-- only thing standing between a future bug and an order that has given back more than it ever took,
-- and a discrepancy like that is discovered weeks later by an accountant, not by whoever caused it.
--
-- These cost nothing on write and turn "we validate this" into "this cannot happen". They were
-- added after a deliberately sabotaged run wrote exactly such a row and it survived in the
-- development database, unnoticed, until an audit query went looking.
--
-- NOT VALID is deliberately not used: the tables are small and every existing row already conforms,
-- so validating now is instant and means the guarantee is real rather than forward-only.

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_refundedPaisa_nonnegative" CHECK ("refundedPaisa" >= 0);

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_refundedPaisa_within_paid" CHECK ("refundedPaisa" <= "paidPaisa");

-- A refund of zero is a row that means nothing; a negative one is a second charge wearing a
-- refund's name.
ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_amountPaisa_positive" CHECK ("amountPaisa" > 0);
