-- Student records (module SIS): configurable matricule, cohorts, administrative
-- and pedagogical registrations, statuses and an append-only history.

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('sis.read', 'SIS', 'Consulter les dossiers étudiants', false),
    ('sis.manage', 'SIS', 'Configurer matricules, cohortes et groupes', false),
    ('sis.enrol', 'SIS', 'Inscrire des étudiants', false),
    ('sis.validate', 'SIS', 'Valider les inscriptions', true),
    ('sis.status', 'SIS', 'Décider des changements de statut et de programme', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;

INSERT INTO unoa.notification_event(code, module, variables, sensitive) VALUES
    ('sis.registration_validated', 'SIS', '{program,matricule,year}', false),
    ('sis.status_changed', 'SIS', '{status,reason}', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE unoa.matricule_rule (
    institution_id uuid PRIMARY KEY REFERENCES unoa.scope(id),
    pattern text NOT NULL CHECK (pattern ~ '^[A-Z0-9/._-]*(\{AAAA\}|\{AA\}|\{SEQ:[3-9]\}|[A-Z0-9/._-])*$'
        AND pattern ~ '\{SEQ:[3-9]\}' AND length(pattern) <= 60),
    next_value bigint NOT NULL DEFAULT 1 CHECK (next_value > 0),
    changed_by uuid NOT NULL REFERENCES unoa.account(id),
    changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unoa.cohort (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id uuid NOT NULL REFERENCES unoa.program_version(id),
    institution_id uuid NOT NULL REFERENCES unoa.scope(id),
    owner_scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
    academic_year text NOT NULL CHECK (academic_year ~ '^[0-9]{4}-[0-9]{4}$'),
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    capacity integer CHECK (capacity IS NULL OR capacity > 0),
    state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (institution_id, code),
    CHECK (ends_on > starts_on)
);

CREATE TABLE unoa.cohort_group (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_id uuid NOT NULL REFERENCES unoa.cohort(id),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
    UNIQUE (cohort_id, label)
);

CREATE TABLE unoa.student (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    institution_id uuid NOT NULL REFERENCES unoa.scope(id),
    matricule text NOT NULL UNIQUE CHECK (length(matricule) BETWEEN 3 AND 60),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'interrupted', 'graduated', 'withdrawn')),
    application_id uuid REFERENCES unoa.application(id),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, institution_id)
);

CREATE TABLE unoa.registration (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid NOT NULL REFERENCES unoa.student(id),
    cohort_id uuid NOT NULL REFERENCES unoa.cohort(id),
    group_id uuid REFERENCES unoa.cohort_group(id),
    academic_year text NOT NULL CHECK (academic_year ~ '^[0-9]{4}-[0-9]{4}$'),
    kind text NOT NULL CHECK (kind IN ('first', 'renewal', 'change')),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'validated', 'cancelled')),
    conditions text CHECK (conditions IS NULL OR length(btrim(conditions)) BETWEEN 1 AND 1000),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    decided_by uuid REFERENCES unoa.account(id),
    decided_at timestamptz,
    CHECK ((state = 'pending') = (decided_by IS NULL)),
    CHECK (decided_by IS NULL OR decided_by <> created_by)
);
-- One administrative registration in force per student and academic year.
CREATE UNIQUE INDEX registration_one_per_year ON unoa.registration(student_id, academic_year) WHERE state <> 'cancelled';

CREATE TABLE unoa.course_registration (
    registration_id uuid NOT NULL REFERENCES unoa.registration(id),
    unit_id uuid NOT NULL REFERENCES unoa.teaching_unit(id),
    state text NOT NULL DEFAULT 'registered' CHECK (state IN ('registered', 'withdrawn', 'validated')),
    changed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (registration_id, unit_id)
);

CREATE TABLE unoa.student_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid NOT NULL REFERENCES unoa.student(id),
    kind text NOT NULL CHECK (kind ~ '^[a-z_]{3,40}$'),
    detail text CHECK (detail IS NULL OR length(detail) <= 1000),
    actor_id uuid NOT NULL REFERENCES unoa.account(id),
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX student_event_student ON unoa.student_event(student_id, occurred_at);
CREATE TRIGGER student_event_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.student_event
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
CREATE TRIGGER registration_kept BEFORE DELETE OR TRUNCATE ON unoa.registration
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
CREATE TRIGGER student_kept BEFORE DELETE OR TRUNCATE ON unoa.student
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Registration rules: the cohort's version is published, the cohort open and
-- not full, the student active; a decided registration is not reopened.
CREATE FUNCTION unoa.validate_registration() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    group_cohort uuid;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.student_id, NEW.cohort_id, NEW.academic_year, NEW.kind, NEW.created_by, NEW.created_at)
            IS DISTINCT FROM ROW(OLD.student_id, OLD.cohort_id, OLD.academic_year, OLD.kind, OLD.created_by, OLD.created_at)
            OR (OLD.state <> 'pending' AND NEW.state IS DISTINCT FROM OLD.state AND NOT (OLD.state = 'validated' AND NEW.state = 'cancelled')) THEN
            RAISE EXCEPTION 'Registration transition refused' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NOT EXISTS (SELECT 1 FROM unoa.cohort JOIN unoa.program_version AS version ON version.id = cohort.version_id
            WHERE cohort.id = NEW.cohort_id AND cohort.state = 'open' AND version.state = 'published' AND cohort.academic_year = NEW.academic_year) THEN
            RAISE EXCEPTION 'The cohort is not open for this year' USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM unoa.student WHERE id = NEW.student_id AND status = 'active') THEN
            RAISE EXCEPTION 'The student is not active' USING ERRCODE = '23514';
        END IF;
        IF (SELECT capacity FROM unoa.cohort WHERE id = NEW.cohort_id) <= (SELECT count(*) FROM unoa.registration
            WHERE cohort_id = NEW.cohort_id AND state <> 'cancelled') THEN
            RAISE EXCEPTION 'The cohort is full' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF NEW.group_id IS NOT NULL THEN
        SELECT cohort_id INTO group_cohort FROM unoa.cohort_group WHERE id = NEW.group_id;
        IF group_cohort IS DISTINCT FROM NEW.cohort_id THEN
            RAISE EXCEPTION 'The group belongs to another cohort' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_registration BEFORE INSERT OR UPDATE ON unoa.registration
FOR EACH ROW EXECUTE FUNCTION unoa.validate_registration();

-- Pedagogical registration only to units of the cohort's programme version.
CREATE FUNCTION unoa.validate_course_registration() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM unoa.registration JOIN unoa.cohort ON cohort.id = registration.cohort_id
        JOIN unoa.teaching_unit AS unit ON unit.version_id = cohort.version_id
        WHERE registration.id = NEW.registration_id AND unit.id = NEW.unit_id AND registration.state <> 'cancelled') THEN
        RAISE EXCEPTION 'This unit is not part of the registered programme' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_course_registration BEFORE INSERT OR UPDATE ON unoa.course_registration
FOR EACH ROW EXECUTE FUNCTION unoa.validate_course_registration();

-- Matricule: generated under a row lock from the institution's configured pattern.
CREATE FUNCTION unoa.next_matricule(institution uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    rule unoa.matricule_rule%ROWTYPE;
    result text;
    width integer;
BEGIN
    SELECT * INTO rule FROM unoa.matricule_rule WHERE institution_id = institution FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No matricule rule for this institution' USING ERRCODE = '23514';
    END IF;
    width := substring(rule.pattern FROM '\{SEQ:([3-9])\}')::integer;
    IF length(rule.next_value::text) > width THEN
        RAISE EXCEPTION 'The matricule sequence is exhausted' USING ERRCODE = '23514';
    END IF;
    result := replace(replace(rule.pattern, '{AAAA}', to_char(statement_timestamp(), 'YYYY')), '{AA}', to_char(statement_timestamp(), 'YY'));
    result := regexp_replace(result, '\{SEQ:[3-9]\}', lpad(rule.next_value::text, width, '0'));
    UPDATE unoa.matricule_rule SET next_value = next_value + 1 WHERE institution_id = institution;
    RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION unoa.next_matricule(uuid) FROM PUBLIC;
