BEGIN;
DO $unoa_role$
BEGIN
  IF current_database() <> 'unoa' THEN
    RAISE EXCEPTION 'Sélectionner la base unoa.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unoa_web') THEN
    CREATE ROLE unoa_web NOLOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSE
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unoa_web'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
      RAISE EXCEPTION 'Le rôle unoa_web possède des privilèges inattendus.';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neon_superuser')
    AND pg_has_role('unoa_web', 'neon_superuser', 'MEMBER') THEN
    RAISE EXCEPTION 'Le rôle unoa_web ne doit pas être membre de neon_superuser.';
  END IF;
END;
$unoa_role$;
COMMIT;
