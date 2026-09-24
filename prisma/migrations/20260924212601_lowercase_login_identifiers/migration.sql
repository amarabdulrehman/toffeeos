-- Store login identifiers lowercase, now that the app lowercases them on the way in.
--
-- Sign-in compared the email and restaurant code exactly as typed, so an iPad keyboard capitalising
-- the first letter was enough to fail a login that looked right on screen. The app now trims and
-- lowercases both before comparing (src/lib/identity.ts). That only works if what is stored is
-- lowercase too, which is what this does for the rows written before.
--
-- Two accounts in the same restaurant whose emails differ only by capitals would become the same
-- login, and there is no safe way to choose between them automatically. So this refuses instead of
-- guessing: the migration raises, the build fails, and the current deployment keeps serving until
-- a person resolves it. The development database has none; this is here for the case nobody
-- expects.

DO $$
DECLARE
  clashes integer;
BEGIN
  SELECT count(*) INTO clashes FROM (
    SELECT "tenantId", lower(trim(email)) FROM "User"
    WHERE email IS NOT NULL
    GROUP BY 1, 2 HAVING count(*) > 1
  ) t;
  IF clashes > 0 THEN
    RAISE EXCEPTION '% restaurant(s) have staff emails that differ only by capitals; resolve them before lowercasing', clashes;
  END IF;

  SELECT count(*) INTO clashes FROM (
    SELECT lower(trim(email)) FROM "PlatformUser" GROUP BY 1 HAVING count(*) > 1
  ) t;
  IF clashes > 0 THEN
    RAISE EXCEPTION '% platform admin email(s) differ only by capitals; resolve them before lowercasing', clashes;
  END IF;

  SELECT count(*) INTO clashes FROM (
    SELECT lower(trim(slug)) FROM "Tenant" GROUP BY 1 HAVING count(*) > 1
  ) t;
  IF clashes > 0 THEN
    RAISE EXCEPTION '% restaurant code(s) differ only by capitals; resolve them before lowercasing', clashes;
  END IF;
END $$;

UPDATE "User" SET "email" = lower(trim("email")) WHERE "email" IS NOT NULL AND "email" <> lower(trim("email"));
UPDATE "Invite" SET "email" = lower(trim("email")) WHERE "email" <> lower(trim("email"));
UPDATE "PlatformUser" SET "email" = lower(trim("email")) WHERE "email" <> lower(trim("email"));
UPDATE "Tenant" SET "slug" = lower(trim("slug")) WHERE "slug" <> lower(trim("slug"));
