-- Academic catalogue: every field, programme kind, programme, curriculum and
-- course is created by the administration. Nothing academic is seeded here.

-- Free taxonomy of domains, fields, specialities, pathways... declared as data.
CREATE TABLE unoa.field_type (
    code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{0,62}$'),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
    root_allowed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unoa.field_type_parent (
    type_code text NOT NULL REFERENCES unoa.field_type(code),
    parent_type_code text NOT NULL REFERENCES unoa.field_type(code),
    PRIMARY KEY (type_code, parent_type_code)
);

CREATE TABLE unoa.academic_field (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    institution_id uuid NOT NULL REFERENCES unoa.scope(id),
    type_code text NOT NULL REFERENCES unoa.field_type(code),
    parent_id uuid REFERENCES unoa.academic_field(id),
    code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
    description text CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 2000),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (institution_id, code)
);

CREATE INDEX academic_field_owner ON unoa.academic_field(owner_scope_id);
CREATE INDEX academic_field_parent ON unoa.academic_field(parent_id);

-- An academic owner is an establishment or one of its active academic units.
CREATE FUNCTION unoa.academic_owner(owner uuid) RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    owner_nature text;
    unit_status text;
BEGIN
    SELECT kind.nature INTO owner_nature
    FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code WHERE scope.id = owner;
    IF owner_nature = 'institution' THEN
        RETURN owner;
    END IF;
    IF owner_nature = 'academic_unit' THEN
        SELECT status INTO unit_status FROM unoa.org_unit WHERE scope_id = owner;
        IF unit_status = 'active' THEN
            RETURN unoa.nearest_institution(owner);
        END IF;
        RAISE EXCEPTION 'An inactive unit cannot carry new academic offers' USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION 'Academic objects belong to an establishment or an academic unit' USING ERRCODE = '23514';
END;
$$;

CREATE FUNCTION unoa.validate_academic_field() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    parent unoa.academic_field%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.id, NEW.owner_scope_id, NEW.institution_id, NEW.type_code, NEW.parent_id, NEW.code, NEW.created_by, NEW.created_at)
            IS DISTINCT FROM ROW(OLD.id, OLD.owner_scope_id, OLD.institution_id, OLD.type_code, OLD.parent_id, OLD.code, OLD.created_by, OLD.created_at) THEN
            RAISE EXCEPTION 'The position of a field in the taxonomy is immutable' USING ERRCODE = '23514';
        END IF;
        IF OLD.status = 'archived' AND NEW.status = 'active' THEN
            RAISE EXCEPTION 'An archived field stays archived' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    NEW.institution_id := unoa.academic_owner(NEW.owner_scope_id);
    IF NEW.parent_id IS NULL THEN
        IF NOT (SELECT root_allowed FROM unoa.field_type WHERE code = NEW.type_code) THEN
            RAISE EXCEPTION 'This field type needs a parent' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO STRICT parent FROM unoa.academic_field WHERE id = NEW.parent_id;
    IF parent.status <> 'active' OR parent.institution_id <> NEW.institution_id THEN
        RAISE EXCEPTION 'The parent field must be active in the same establishment' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unoa.field_type_parent WHERE type_code = NEW.type_code AND parent_type_code = parent.type_code) THEN
        RAISE EXCEPTION 'This field hierarchy is not declared' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_academic_field
BEFORE INSERT OR UPDATE ON unoa.academic_field
FOR EACH ROW EXECUTE FUNCTION unoa.validate_academic_field();

-- Programme natures (bachelor, master, doctorate, short course...) are data.
CREATE TABLE unoa.program_kind (
    code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{0,62}$'),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
    degree_awarding boolean NOT NULL,
    description text CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 1000),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unoa.program (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    institution_id uuid NOT NULL REFERENCES unoa.scope(id),
    field_id uuid REFERENCES unoa.academic_field(id),
    kind_code text NOT NULL REFERENCES unoa.program_kind(code),
    code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (institution_id, code)
);

CREATE INDEX program_owner ON unoa.program(owner_scope_id);

CREATE FUNCTION unoa.validate_program() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.id, NEW.owner_scope_id, NEW.institution_id, NEW.field_id, NEW.kind_code, NEW.code, NEW.created_by, NEW.created_at)
            IS DISTINCT FROM ROW(OLD.id, OLD.owner_scope_id, OLD.institution_id, OLD.field_id, OLD.kind_code, OLD.code, OLD.created_by, OLD.created_at) THEN
            RAISE EXCEPTION 'The identity of a programme is immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    NEW.institution_id := unoa.academic_owner(NEW.owner_scope_id);
    IF NEW.field_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM unoa.academic_field
        WHERE id = NEW.field_id AND institution_id = NEW.institution_id AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'The field must be active in the same establishment' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_program
BEFORE INSERT OR UPDATE ON unoa.program
FOR EACH ROW EXECUTE FUNCTION unoa.validate_program();

CREATE TABLE unoa.program_label (
    program_id uuid NOT NULL REFERENCES unoa.program(id),
    language text NOT NULL CHECK (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    summary text CHECK (summary IS NULL OR length(btrim(summary)) BETWEEN 1 AND 2000),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (program_id, language)
);

CREATE TABLE unoa.program_version (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id uuid NOT NULL REFERENCES unoa.program(id),
    number integer NOT NULL CHECK (number > 0),
    based_on uuid REFERENCES unoa.program_version(id),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'review', 'approved', 'published', 'retired')),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    organisation text NOT NULL CHECK (length(btrim(organisation)) BETWEEN 1 AND 120),
    duration text NOT NULL CHECK (length(btrim(duration)) BETWEEN 1 AND 120),
    delivery_mode text NOT NULL CHECK (length(btrim(delivery_mode)) BETWEEN 1 AND 120),
    credit_unit text NOT NULL CHECK (length(btrim(credit_unit)) BETWEEN 1 AND 60),
    expected_credits numeric(8, 2) CHECK (expected_credits IS NULL OR expected_credits > 0),
    languages text[] NOT NULL DEFAULT '{}'
        CHECK (cardinality(languages) <= 16 AND array_to_string(languages, ',') ~ '^([a-z]{2,3}(-[A-Z]{2})?(,|$))*$'),
    capacity integer CHECK (capacity IS NULL OR capacity > 0),
    objectives text CHECK (objectives IS NULL OR length(btrim(objectives)) BETWEEN 1 AND 4000),
    admission text CHECK (admission IS NULL OR length(btrim(admission)) BETWEEN 1 AND 4000),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    submitted_at timestamptz,
    reviewer_id uuid REFERENCES unoa.account(id),
    reviewed_at timestamptz,
    review_note text CHECK (review_note IS NULL OR length(btrim(review_note)) BETWEEN 1 AND 1000),
    publisher_id uuid REFERENCES unoa.account(id),
    published_at timestamptz,
    admission_open boolean NOT NULL DEFAULT false,
    admission_changed_by uuid REFERENCES unoa.account(id),
    admission_changed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    row_version integer NOT NULL DEFAULT 1,
    UNIQUE (program_id, number),
    CHECK (reviewer_id IS NULL OR reviewer_id <> author_id),
    CHECK (NOT admission_open OR state = 'published')
);

-- Only one working version per programme at a time.
CREATE UNIQUE INDEX program_version_working ON unoa.program_version(program_id)
    WHERE state IN ('draft', 'review', 'approved');
CREATE UNIQUE INDEX program_version_current ON unoa.program_version(program_id) WHERE state = 'published';

-- Regulatory status, recorded with evidence then verified by another account.
CREATE TABLE unoa.program_authorization (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id uuid NOT NULL REFERENCES unoa.program(id),
    territory_id uuid REFERENCES unoa.scope(id),
    status text NOT NULL CHECK (status IN ('preparation', 'non_degree', 'conditional', 'authorized', 'suspended', 'expired')),
    authority text NOT NULL CHECK (length(btrim(authority)) BETWEEN 1 AND 200),
    evidence text NOT NULL CHECK (length(btrim(evidence)) BETWEEN 1 AND 1000),
    valid_from timestamptz NOT NULL,
    valid_until timestamptz,
    recorded_by uuid NOT NULL REFERENCES unoa.account(id),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    verified_by uuid REFERENCES unoa.account(id),
    verified_at timestamptz,
    CHECK (valid_until IS NULL OR valid_until > valid_from),
    CHECK (verified_by IS NULL OR verified_by <> recorded_by),
    CHECK ((verified_by IS NULL) = (verified_at IS NULL))
);

CREATE INDEX program_authorization_program ON unoa.program_authorization(program_id, valid_from DESC);

CREATE FUNCTION unoa.validate_program_authorization() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.verified_by IS NOT NULL THEN
            RAISE EXCEPTION 'An authorization is verified by another account after recording' USING ERRCODE = '23514';
        END IF;
        IF NEW.territory_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
            WHERE scope.id = NEW.territory_id AND kind.nature IN ('territory', 'jurisdiction')
        ) THEN
            RAISE EXCEPTION 'An authorization applies to a territory or a jurisdiction' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.verified_by IS NOT NULL OR ROW(NEW.id, NEW.program_id, NEW.territory_id, NEW.status, NEW.authority,
        NEW.evidence, NEW.valid_from, NEW.valid_until, NEW.recorded_by, NEW.recorded_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.program_id, OLD.territory_id, OLD.status, OLD.authority,
        OLD.evidence, OLD.valid_from, OLD.valid_until, OLD.recorded_by, OLD.recorded_at) THEN
        RAISE EXCEPTION 'A recorded authorization is superseded, never rewritten' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_program_authorization
BEFORE INSERT OR UPDATE ON unoa.program_authorization
FOR EACH ROW EXECUTE FUNCTION unoa.validate_program_authorization();

CREATE TRIGGER program_authorization_kept
BEFORE DELETE OR TRUNCATE ON unoa.program_authorization
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Effective regulatory status: the most recent verified record in force.
CREATE FUNCTION unoa.program_regulatory_status(target uuid) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT coalesce((
        SELECT status FROM unoa.program_authorization
        WHERE program_id = target AND verified_by IS NOT NULL
          AND valid_from <= statement_timestamp()
          AND (valid_until IS NULL OR valid_until > statement_timestamp())
        ORDER BY valid_from DESC, recorded_at DESC
        LIMIT 1
    ), 'unverified');
$$;

-- A degree-awarding programme opens only when authorized (possibly under
-- conditions); a non-degree programme also accepts a verified non-degree status.
CREATE FUNCTION unoa.program_admission_allowed(target uuid) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT CASE unoa.program_regulatory_status(target)
        WHEN 'authorized' THEN true
        WHEN 'conditional' THEN true
        WHEN 'non_degree' THEN NOT kind.degree_awarding
        ELSE false
    END
    FROM unoa.program JOIN unoa.program_kind AS kind ON kind.code = program.kind_code
    WHERE program.id = target;
$$;

CREATE FUNCTION unoa.validate_program_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.state <> 'draft' OR NEW.admission_open THEN
            RAISE EXCEPTION 'A version starts as a draft' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF ROW(NEW.id, NEW.program_id, NEW.number, NEW.based_on, NEW.author_id, NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.program_id, OLD.number, OLD.based_on, OLD.author_id, OLD.created_at) THEN
        RAISE EXCEPTION 'The identity of a version is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.state <> 'draft' AND ROW(NEW.title, NEW.organisation, NEW.duration, NEW.delivery_mode, NEW.credit_unit,
        NEW.expected_credits, NEW.languages, NEW.capacity, NEW.objectives, NEW.admission)
        IS DISTINCT FROM ROW(OLD.title, OLD.organisation, OLD.duration, OLD.delivery_mode, OLD.credit_unit,
        OLD.expected_credits, OLD.languages, OLD.capacity, OLD.objectives, OLD.admission) THEN
        RAISE EXCEPTION 'Only a draft version is edited' USING ERRCODE = '23514';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
        (OLD.state = 'draft' AND NEW.state = 'review')
        OR (OLD.state = 'review' AND NEW.state IN ('draft', 'approved'))
        OR (OLD.state = 'approved' AND NEW.state IN ('draft', 'published'))
        OR (OLD.state = 'published' AND NEW.state = 'retired')
    ) THEN
        RAISE EXCEPTION 'Version transition refused' USING ERRCODE = '23514';
    END IF;
    IF NEW.state = 'approved' AND OLD.state = 'review' AND (NEW.reviewer_id IS NULL OR NEW.reviewer_id = NEW.author_id) THEN
        RAISE EXCEPTION 'A version is approved by another account' USING ERRCODE = '23514';
    END IF;
    IF NEW.admission_open AND NOT OLD.admission_open AND NOT unoa.program_admission_allowed(NEW.program_id) THEN
        RAISE EXCEPTION 'No verified authorization allows admissions' USING ERRCODE = '23514';
    END IF;
    IF NEW.state = 'retired' THEN
        NEW.admission_open := false;
    END IF;
    NEW.row_version := OLD.row_version + 1;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_program_version
BEFORE INSERT OR UPDATE ON unoa.program_version
FOR EACH ROW EXECUTE FUNCTION unoa.validate_program_version();

CREATE TRIGGER program_version_kept
BEFORE DELETE OR TRUNCATE ON unoa.program_version
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Curriculum content belongs to one version and changes only while it is a draft.
CREATE FUNCTION unoa.guard_version_content() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    target uuid;
BEGIN
    IF TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'Curriculum content is never truncated' USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN target := OLD.version_id; ELSE target := NEW.version_id; END IF;
    IF TG_OP = 'UPDATE' AND NEW.version_id IS DISTINCT FROM OLD.version_id THEN
        RAISE EXCEPTION 'Content does not move between versions' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unoa.program_version WHERE id = target AND state = 'draft' FOR SHARE) THEN
        RAISE EXCEPTION 'Only a draft version is edited' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE TABLE unoa.program_period (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id uuid NOT NULL REFERENCES unoa.program_version(id),
    ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
    UNIQUE (version_id, ordinal),
    UNIQUE (id, version_id)
);

CREATE TABLE unoa.option_group (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id uuid NOT NULL,
    period_id uuid NOT NULL,
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
    min_choices integer NOT NULL CHECK (min_choices >= 0),
    max_choices integer NOT NULL CHECK (max_choices >= 1),
    CHECK (max_choices >= min_choices),
    UNIQUE (id, version_id),
    FOREIGN KEY (period_id, version_id) REFERENCES unoa.program_period(id, version_id)
);

CREATE TABLE unoa.teaching_unit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id uuid NOT NULL,
    period_id uuid NOT NULL,
    code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    credits numeric(8, 2) NOT NULL CHECK (credits >= 0),
    coefficient numeric(8, 2) NOT NULL DEFAULT 1 CHECK (coefficient > 0),
    option_group_id uuid,
    description text CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 2000),
    UNIQUE (version_id, code),
    UNIQUE (id, version_id),
    FOREIGN KEY (period_id, version_id) REFERENCES unoa.program_period(id, version_id),
    FOREIGN KEY (option_group_id, version_id) REFERENCES unoa.option_group(id, version_id)
);

CREATE FUNCTION unoa.validate_teaching_unit() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF NEW.option_group_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM unoa.option_group WHERE id = NEW.option_group_id AND period_id = NEW.period_id
    ) THEN
        RAISE EXCEPTION 'An elective belongs to an option group of the same period' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_teaching_unit
BEFORE INSERT OR UPDATE ON unoa.teaching_unit
FOR EACH ROW EXECUTE FUNCTION unoa.validate_teaching_unit();

CREATE TABLE unoa.unit_volume (
    unit_id uuid NOT NULL,
    version_id uuid NOT NULL,
    activity text NOT NULL CHECK (length(btrim(activity)) BETWEEN 1 AND 60),
    hours numeric(7, 2) NOT NULL CHECK (hours > 0),
    PRIMARY KEY (unit_id, activity),
    FOREIGN KEY (unit_id, version_id) REFERENCES unoa.teaching_unit(id, version_id)
);

-- Catalogue courses are shared across programmes of the same establishment.
CREATE TABLE unoa.course (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    institution_id uuid NOT NULL REFERENCES unoa.scope(id),
    code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    description text CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 2000),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (institution_id, code)
);

CREATE FUNCTION unoa.validate_course() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.id, NEW.owner_scope_id, NEW.institution_id, NEW.code, NEW.created_by, NEW.created_at)
            IS DISTINCT FROM ROW(OLD.id, OLD.owner_scope_id, OLD.institution_id, OLD.code, OLD.created_by, OLD.created_at) THEN
            RAISE EXCEPTION 'The identity of a course is immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    NEW.institution_id := unoa.academic_owner(NEW.owner_scope_id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_course
BEFORE INSERT OR UPDATE ON unoa.course
FOR EACH ROW EXECUTE FUNCTION unoa.validate_course();

CREATE TABLE unoa.unit_course (
    unit_id uuid NOT NULL,
    version_id uuid NOT NULL,
    course_id uuid NOT NULL REFERENCES unoa.course(id),
    coefficient numeric(8, 2) NOT NULL DEFAULT 1 CHECK (coefficient > 0),
    credits numeric(8, 2) CHECK (credits IS NULL OR credits >= 0),
    PRIMARY KEY (unit_id, course_id),
    FOREIGN KEY (unit_id, version_id) REFERENCES unoa.teaching_unit(id, version_id)
);

CREATE INDEX unit_course_course ON unoa.unit_course(course_id);

CREATE FUNCTION unoa.validate_unit_course() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM unoa.course
        JOIN unoa.program_version AS version ON version.id = NEW.version_id
        JOIN unoa.program ON program.id = version.program_id
        WHERE course.id = NEW.course_id AND course.institution_id = program.institution_id
    ) THEN
        RAISE EXCEPTION 'A shared course comes from the same establishment' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_unit_course
BEFORE INSERT OR UPDATE ON unoa.unit_course
FOR EACH ROW EXECUTE FUNCTION unoa.validate_unit_course();

CREATE TABLE unoa.unit_prerequisite (
    unit_id uuid NOT NULL,
    required_unit_id uuid NOT NULL,
    version_id uuid NOT NULL,
    PRIMARY KEY (unit_id, required_unit_id),
    CHECK (unit_id <> required_unit_id),
    FOREIGN KEY (unit_id, version_id) REFERENCES unoa.teaching_unit(id, version_id),
    FOREIGN KEY (required_unit_id, version_id) REFERENCES unoa.teaching_unit(id, version_id)
);

CREATE FUNCTION unoa.validate_unit_prerequisite() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('unoa.catalog.prerequisites.' || NEW.version_id::text, 0));
    IF EXISTS (
        WITH RECURSIVE chain AS (
            SELECT required_unit_id AS unit FROM unoa.unit_prerequisite WHERE unit_id = NEW.required_unit_id
            UNION
            SELECT link.required_unit_id FROM unoa.unit_prerequisite AS link JOIN chain ON link.unit_id = chain.unit
        )
        SELECT 1 FROM chain WHERE unit = NEW.unit_id
    ) THEN
        RAISE EXCEPTION 'This prerequisite creates a cycle' USING ERRCODE = '23514';
    END IF;
    IF (SELECT period.ordinal FROM unoa.teaching_unit AS unit JOIN unoa.program_period AS period ON period.id = unit.period_id
        WHERE unit.id = NEW.required_unit_id)
        >= (SELECT period.ordinal FROM unoa.teaching_unit AS unit JOIN unoa.program_period AS period ON period.id = unit.period_id
        WHERE unit.id = NEW.unit_id) THEN
        RAISE EXCEPTION 'A prerequisite belongs to an earlier period' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_unit_prerequisite
BEFORE INSERT OR UPDATE ON unoa.unit_prerequisite
FOR EACH ROW EXECUTE FUNCTION unoa.validate_unit_prerequisite();

CREATE TABLE unoa.competency (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
    description text CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 2000),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_scope_id, code)
);

CREATE TABLE unoa.version_competency (
    version_id uuid NOT NULL REFERENCES unoa.program_version(id),
    competency_id uuid NOT NULL REFERENCES unoa.competency(id),
    PRIMARY KEY (version_id, competency_id)
);

CREATE TABLE unoa.unit_competency (
    unit_id uuid NOT NULL,
    version_id uuid NOT NULL,
    competency_id uuid NOT NULL,
    level text NOT NULL CHECK (length(btrim(level)) BETWEEN 1 AND 60),
    PRIMARY KEY (unit_id, competency_id),
    FOREIGN KEY (unit_id, version_id) REFERENCES unoa.teaching_unit(id, version_id),
    FOREIGN KEY (version_id, competency_id) REFERENCES unoa.version_competency(version_id, competency_id)
);

CREATE TABLE unoa.version_requirement (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id uuid NOT NULL REFERENCES unoa.program_version(id),
    kind text NOT NULL CHECK (kind IN ('internship', 'thesis', 'defense', 'project', 'other')),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
    period_id uuid,
    credits numeric(8, 2) CHECK (credits IS NULL OR credits >= 0),
    mandatory boolean NOT NULL DEFAULT true,
    conditions text CHECK (conditions IS NULL OR length(btrim(conditions)) BETWEEN 1 AND 2000),
    FOREIGN KEY (period_id, version_id) REFERENCES unoa.program_period(id, version_id)
);

CREATE TABLE unoa.version_territory (
    version_id uuid NOT NULL REFERENCES unoa.program_version(id),
    territory_id uuid NOT NULL REFERENCES unoa.scope(id),
    PRIMARY KEY (version_id, territory_id)
);

CREATE FUNCTION unoa.validate_version_territory() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
        WHERE scope.id = NEW.territory_id AND kind.nature = 'territory'
    ) THEN
        RAISE EXCEPTION 'An eligible zone is a territory' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_version_territory
BEFORE INSERT OR UPDATE ON unoa.version_territory
FOR EACH ROW EXECUTE FUNCTION unoa.validate_version_territory();

-- Equivalences from an earlier version (or another programme) to the draft.
CREATE TABLE unoa.unit_equivalence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id uuid NOT NULL,
    target_unit_id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    source_unit_id uuid NOT NULL,
    note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 1000),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_unit_id, target_unit_id),
    CHECK (source_version_id <> version_id),
    FOREIGN KEY (target_unit_id, version_id) REFERENCES unoa.teaching_unit(id, version_id),
    FOREIGN KEY (source_unit_id, source_version_id) REFERENCES unoa.teaching_unit(id, version_id)
);

CREATE FUNCTION unoa.validate_unit_equivalence() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM unoa.program_version AS target_version
        JOIN unoa.program AS target ON target.id = target_version.program_id
        JOIN unoa.program_version AS source_version ON source_version.id = NEW.source_version_id
        JOIN unoa.program AS source ON source.id = source_version.program_id
        WHERE target_version.id = NEW.version_id
          AND source.institution_id = target.institution_id
          AND source_version.state IN ('published', 'retired')
    ) THEN
        RAISE EXCEPTION 'An equivalence starts from a published version of the same establishment' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_unit_equivalence
BEFORE INSERT OR UPDATE ON unoa.unit_equivalence
FOR EACH ROW EXECUTE FUNCTION unoa.validate_unit_equivalence();

CREATE TRIGGER guard_program_period BEFORE INSERT OR UPDATE OR DELETE ON unoa.program_period
FOR EACH ROW EXECUTE FUNCTION unoa.guard_version_content();
CREATE TRIGGER guard_option_group BEFORE INSERT OR UPDATE OR DELETE ON unoa.option_group
FOR EACH ROW EXECUTE FUNCTION unoa.guard_version_content();
CREATE TRIGGER guard_teaching_unit BEFORE INSERT OR UPDATE OR DELETE ON unoa.teaching_unit
FOR EACH ROW EXECUTE FUNCTION unoa.guard_version_content();
CREATE TRIGGER guard_unit_volume BEFORE INSERT OR UPDATE OR DELETE ON unoa.unit_volume
FOR EACH ROW EXECUTE FUNCTION unoa.guard_version_content();
CREATE TRIGGER guard_unit_course BEFORE INSERT OR UPDATE OR DELETE ON unoa.unit_course
FOR EACH ROW EXECUTE FUNCTION unoa.guard_version_content();
CREATE TRIGGER guard_unit_prerequisite BEFORE INSERT OR UPDATE OR DELETE ON unoa.unit_prerequisite
FOR EACH ROW EXECUTE FUNCTION unoa.guard_version_content();
CREATE TRIGGER guard_version_competency BEFORE INSERT OR UPDATE OR DELETE ON unoa.version_competency
FOR EACH ROW EXECUTE FUNCTION unoa.guard_version_content();
CREATE TRIGGER guard_unit_competency BEFORE INSERT OR UPDATE OR DELETE ON unoa.unit_competency
FOR EACH ROW EXECUTE FUNCTION unoa.guard_version_content();
CREATE TRIGGER guard_version_requirement BEFORE INSERT OR UPDATE OR DELETE ON unoa.version_requirement
FOR EACH ROW EXECUTE FUNCTION unoa.guard_version_content();
CREATE TRIGGER guard_version_territory BEFORE INSERT OR UPDATE OR DELETE ON unoa.version_territory
FOR EACH ROW EXECUTE FUNCTION unoa.guard_version_content();
CREATE TRIGGER guard_unit_equivalence BEFORE INSERT OR UPDATE OR DELETE ON unoa.unit_equivalence
FOR EACH ROW EXECUTE FUNCTION unoa.guard_version_content();

CREATE TRIGGER program_period_kept BEFORE TRUNCATE ON unoa.program_period
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
CREATE TRIGGER teaching_unit_kept BEFORE TRUNCATE ON unoa.teaching_unit
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Public directory: only the current published version of each programme,
-- with its verified regulatory status, never a draft.
CREATE FUNCTION unoa.public_programs()
RETURNS TABLE (program_id uuid, version_id uuid, version_number integer, code text, title text,
               kind_label text, degree_awarding boolean, field_label text, institution_label text,
               owner_label text, delivery_mode text, duration text, languages text[],
               territories text[], regulatory_status text, admission_open boolean, published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT program.id, version.id, version.number, program.code, version.title,
           kind.label, kind.degree_awarding, field.label, institution.label, owner.label,
           version.delivery_mode, version.duration, version.languages,
           coalesce((SELECT array_agg(zone.label ORDER BY zone.label)
                     FROM unoa.version_territory AS eligible
                     JOIN unoa.scope AS zone ON zone.id = eligible.territory_id
                     WHERE eligible.version_id = version.id), '{}'),
           unoa.program_regulatory_status(program.id),
           version.admission_open AND unoa.program_admission_allowed(program.id),
           version.published_at
    FROM unoa.program_version AS version
    JOIN unoa.program ON program.id = version.program_id
    JOIN unoa.program_kind AS kind ON kind.code = program.kind_code
    JOIN unoa.scope AS institution ON institution.id = program.institution_id
    JOIN unoa.scope AS owner ON owner.id = program.owner_scope_id
    LEFT JOIN unoa.academic_field AS field ON field.id = program.field_id
    WHERE version.state = 'published'
    ORDER BY version.title, program.code
    LIMIT 2000;
$$;

CREATE FUNCTION unoa.public_program_sheet(target uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT jsonb_build_object(
        'program', jsonb_build_object(
            'id', program.id, 'code', program.code, 'kind', kind.label, 'degreeAwarding', kind.degree_awarding,
            'field', field.label, 'institution', institution.label, 'owner', owner.label,
            'regulatoryStatus', unoa.program_regulatory_status(program.id),
            'admissionOpen', version.admission_open AND unoa.program_admission_allowed(program.id),
            'labels', coalesce((SELECT jsonb_agg(jsonb_build_object('language', label.language, 'title', label.title,
                'summary', label.summary) ORDER BY label.language) FROM unoa.program_label AS label
                WHERE label.program_id = program.id), '[]'::jsonb)),
        'version', jsonb_build_object(
            'id', version.id, 'number', version.number, 'title', version.title, 'organisation', version.organisation,
            'duration', version.duration, 'deliveryMode', version.delivery_mode, 'creditUnit', version.credit_unit,
            'expectedCredits', version.expected_credits, 'languages', version.languages, 'capacity', version.capacity,
            'objectives', version.objectives, 'admission', version.admission, 'publishedAt', version.published_at),
        'territories', coalesce((SELECT jsonb_agg(zone.label ORDER BY zone.label) FROM unoa.version_territory AS eligible
            JOIN unoa.scope AS zone ON zone.id = eligible.territory_id WHERE eligible.version_id = version.id), '[]'::jsonb),
        'competencies', coalesce((SELECT jsonb_agg(jsonb_build_object('code', competency.code, 'label', competency.label)
            ORDER BY competency.code) FROM unoa.version_competency AS link
            JOIN unoa.competency ON competency.id = link.competency_id WHERE link.version_id = version.id), '[]'::jsonb),
        'requirements', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', requirement.kind, 'label', requirement.label,
            'credits', requirement.credits, 'mandatory', requirement.mandatory) ORDER BY requirement.label)
            FROM unoa.version_requirement AS requirement WHERE requirement.version_id = version.id), '[]'::jsonb),
        'periods', coalesce((SELECT jsonb_agg(jsonb_build_object('ordinal', period.ordinal, 'label', period.label,
            'groups', coalesce((SELECT jsonb_agg(jsonb_build_object('id', grp.id, 'label', grp.label,
                'min', grp.min_choices, 'max', grp.max_choices) ORDER BY grp.label)
                FROM unoa.option_group AS grp WHERE grp.period_id = period.id), '[]'::jsonb),
            'units', coalesce((SELECT jsonb_agg(jsonb_build_object('id', unit.id, 'code', unit.code, 'title', unit.title,
                'credits', unit.credits, 'coefficient', unit.coefficient, 'groupId', unit.option_group_id,
                'volumes', coalesce((SELECT jsonb_agg(jsonb_build_object('activity', volume.activity, 'hours', volume.hours)
                    ORDER BY volume.activity) FROM unoa.unit_volume AS volume WHERE volume.unit_id = unit.id), '[]'::jsonb),
                'courses', coalesce((SELECT jsonb_agg(jsonb_build_object('code', course.code, 'title', course.title)
                    ORDER BY course.code) FROM unoa.unit_course AS link JOIN unoa.course ON course.id = link.course_id
                    WHERE link.unit_id = unit.id), '[]'::jsonb),
                'requires', coalesce((SELECT jsonb_agg(link.required_unit_id) FROM unoa.unit_prerequisite AS link
                    WHERE link.unit_id = unit.id), '[]'::jsonb))
                ORDER BY unit.code) FROM unoa.teaching_unit AS unit WHERE unit.period_id = period.id), '[]'::jsonb))
            ORDER BY period.ordinal) FROM unoa.program_period AS period WHERE period.version_id = version.id), '[]'::jsonb))
    FROM unoa.program_version AS version
    JOIN unoa.program ON program.id = version.program_id
    JOIN unoa.program_kind AS kind ON kind.code = program.kind_code
    JOIN unoa.scope AS institution ON institution.id = program.institution_id
    JOIN unoa.scope AS owner ON owner.id = program.owner_scope_id
    LEFT JOIN unoa.academic_field AS field ON field.id = program.field_id
    WHERE program.id = target AND version.state = 'published';
$$;

REVOKE EXECUTE ON FUNCTION unoa.public_programs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION unoa.public_program_sheet(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION unoa.academic_owner(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION unoa.program_regulatory_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION unoa.program_admission_allowed(uuid) FROM PUBLIC;
