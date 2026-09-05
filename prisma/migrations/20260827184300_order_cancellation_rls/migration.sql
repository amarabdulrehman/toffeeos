-- RLS for the new tenant-scoped order cancellation review table.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "OrderCancellation" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "OrderCancellation" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "OrderCancellation" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';
END
$$;
