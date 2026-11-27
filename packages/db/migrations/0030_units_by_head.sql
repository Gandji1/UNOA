-- In the cascade (ADR-0016) the head of a level creates the level below as its
-- own decision: a faculty created by the rector, or a department created by the
-- dean, is active at once (recorded as decided by its creator, flagged by_head).
-- Proposals by anyone else keep the validation by another person.
ALTER TABLE unoa.org_unit ADD COLUMN by_head boolean NOT NULL DEFAULT false;
DO $$
DECLARE item record;
BEGIN
    FOR item IN SELECT conname FROM pg_constraint WHERE conrelid = 'unoa.org_unit'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%decided_by <> proposed_by%' LOOP
        EXECUTE format('ALTER TABLE unoa.org_unit DROP CONSTRAINT %I', item.conname);
    END LOOP;
END $$;
ALTER TABLE unoa.org_unit ADD CONSTRAINT org_unit_decider CHECK (decided_by IS NULL OR decided_by <> proposed_by OR by_head);

-- Short role names, as used in universities.
UPDATE unoa.access_role SET label = item.label FROM (VALUES ('institution_admin', 'Recteur'), ('dean', 'Doyen'), ('department_head', 'Chef de département'),
    ('platform_admin', 'Super-administrateur'), ('country_admin', 'Administrateur pays')) AS item(code, label) WHERE access_role.code = item.code;
