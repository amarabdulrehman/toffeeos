-- RLS for the two new tenant-scoped tables this phase adds (SyncActionLog, SyncConflict).
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "SyncActionLog" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "SyncActionLog" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "SyncActionLog" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';

  EXECUTE 'ALTER TABLE "SyncConflict" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "SyncConflict" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "SyncConflict" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';
END
$$;
