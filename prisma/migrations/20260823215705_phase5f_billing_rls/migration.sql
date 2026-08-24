-- RLS for the new tenant-scoped billing ledger table.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "SubscriptionPayment" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "SubscriptionPayment" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "SubscriptionPayment" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';
END
$$;
