-- RLS for CashDrawerDay. Same template as the expenses / order-cancellation RLS migrations: FORCE
-- so even the table owner can't bypass, and current_setting(..., true) so an unset app.tenant_id
-- yields NULL (never true) and the policy fails closed rather than erroring.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "CashDrawerDay" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "CashDrawerDay" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "CashDrawerDay" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';
END
$$;
