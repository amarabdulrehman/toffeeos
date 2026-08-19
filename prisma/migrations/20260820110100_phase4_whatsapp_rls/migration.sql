-- RLS for the four new tenant-scoped WhatsApp tables.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "WhatsAppSettings" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "WhatsAppSettings" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "WhatsAppSettings" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';

  EXECUTE 'ALTER TABLE "WhatsAppRecipient" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "WhatsAppRecipient" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "WhatsAppRecipient" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';

  EXECUTE 'ALTER TABLE "WhatsAppTemplate" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "WhatsAppTemplate" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "WhatsAppTemplate" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';

  EXECUTE 'ALTER TABLE "WhatsAppMessageLog" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "WhatsAppMessageLog" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "WhatsAppMessageLog" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';
END
$$;
