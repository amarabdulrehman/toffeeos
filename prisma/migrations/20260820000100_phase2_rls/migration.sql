-- Extends the Phase 1 RLS policy (prisma/migrations/*_rls_and_roles/migration.sql) to the five
-- new tenant-scoped tables from Phase 2 (Table/Floor management already had RLS from Phase 1 —
-- this migration is only for the new Inventory tables). Same policy shape: FORCE ROW LEVEL
-- SECURITY + a "tenantId" = current session's app.tenant_id check. app_user and platform_user
-- already have table-level GRANTs via ALTER DEFAULT PRIVILEGES from the Phase 1 migration, so no
-- GRANT statements are needed here — only the policies themselves.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'StockLocation', 'InventoryItem', 'StockLevel', 'StockMovement', 'LowStockAlert'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END
$$;
