-- RLS for the two new tenant-scoped HR tables.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "Shift" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "Shift" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "Shift" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';

  EXECUTE 'ALTER TABLE "AttendanceRecord" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "AttendanceRecord" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "AttendanceRecord" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';
END
$$;
