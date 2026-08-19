-- RLS for the one new tenant-scoped table this phase adds (RecipeLine). BranchSettings already
-- had RLS from Phase 1 — adding a column doesn't need a new policy.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "RecipeLine" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "RecipeLine" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY tenant_isolation ON "RecipeLine" USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))';
END
$$;
