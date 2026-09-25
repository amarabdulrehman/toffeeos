-- Two permissions that gate something for the first time get added to the standard roles that
-- should have them, in every restaurant that already exists. New restaurants get them from
-- SEED_ROLES in src/server/permissions/registry.ts; this brings the existing ones level.
--
-- Additive and idempotent: each permission is appended only where it is missing, and only to
-- system roles. A role an owner has customised (isSystem = false) is left exactly as they made it.
-- Doing it here rather than with `npm run db:sync-roles` means the deploy applies it by itself.

UPDATE "Role"
SET permissions = array_append(permissions, 'kds.order.recall')
WHERE key = 'kitchen' AND "isSystem" = true AND NOT ('kds.order.recall' = ANY(permissions));

UPDATE "Role"
SET permissions = array_append(permissions, 'tables.merge')
WHERE key = 'cashier' AND "isSystem" = true AND NOT ('tables.merge' = ANY(permissions));
