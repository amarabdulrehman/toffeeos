-- RLS for the new tenant-scoped payroll disbursement table.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "PayrollDisbursement" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "PayrollDisbursement" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "PayrollDisbursement" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';
END
$$;
