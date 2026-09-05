-- RLS for the three new tenant-scoped expense tables (Phase 8).
-- Same template as the order-cancellation / payroll-disbursement RLS migrations: FORCE so even the
-- table owner can't bypass, and current_setting(..., true) so an unset app.tenant_id yields NULL
-- (never true) and the policy fails closed rather than erroring.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "ExpenseCategory" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "ExpenseCategory" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "ExpenseCategory" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';

  EXECUTE 'ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "Expense" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "Expense" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';

  EXECUTE 'ALTER TABLE "RecurringExpense" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "RecurringExpense" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "RecurringExpense" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';
END
$$;
