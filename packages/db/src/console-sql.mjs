import { loadMigrations, migrationLock, migrationMetadataSql } from './migrations.mjs';

export async function generateConsoleSql(databaseName, migrationDirectory) {
  if (typeof databaseName !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
    throw new Error('Indiquer le nom exact de la base PostgreSQL cible.');
  }
  const migrations = await loadMigrations(migrationDirectory);
  const entries = migrations.map(({ name, checksum, sql }) => {
    let delimiter = '$migration_' + checksum.slice(0, 12) + '$';
    while (sql.includes(delimiter)) delimiter = delimiter.slice(0, -1) + '_$';
    return `('${name}', '${checksum}', ${delimiter}${sql}${delimiter})`;
  });

  return `-- UNOA. Sélectionner la branche Neon voulue avant l’exécution.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '30s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $unoa_check$
BEGIN
  IF current_database() <> '${databaseName}' THEN
    RAISE EXCEPTION 'Base inattendue. Sélectionner la base UNOA cible.';
  END IF;
END;
$unoa_check$;

SELECT pg_advisory_xact_lock(${migrationLock});
${migrationMetadataSql}

CREATE TEMP TABLE unoa_migration_manifest (
  name text PRIMARY KEY, checksum text NOT NULL, migration_sql text NOT NULL
) ON COMMIT DROP;
INSERT INTO unoa_migration_manifest VALUES
${entries.join(',\n')};

DO $unoa_install$
DECLARE
  installed text[];
  expected text[];
  candidate record;
BEGIN
  SELECT coalesce(array_agg(name || ':' || checksum ORDER BY name), ARRAY[]::text[])
    INTO installed FROM unoa_meta.migration;
  SELECT coalesce(array_agg(name || ':' || checksum ORDER BY name), ARRAY[]::text[])
    INTO expected FROM (
      SELECT name, checksum FROM pg_temp.unoa_migration_manifest
      ORDER BY name LIMIT cardinality(installed)
    ) AS prefix;

  IF installed IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Historique des migrations incohérent. Restaurer le manifeste approuvé.';
  END IF;

  FOR candidate IN
    SELECT manifest.name, manifest.checksum, manifest.migration_sql
    FROM pg_temp.unoa_migration_manifest AS manifest
    WHERE NOT EXISTS (SELECT 1 FROM unoa_meta.migration AS applied WHERE applied.name = manifest.name)
    ORDER BY manifest.name
  LOOP
    EXECUTE candidate.migration_sql;
    INSERT INTO unoa_meta.migration(name, checksum) VALUES (candidate.name, candidate.checksum);
  END LOOP;
END;
$unoa_install$;
COMMIT;

SELECT name, checksum, applied_at FROM unoa_meta.migration ORDER BY name;
`;
}
