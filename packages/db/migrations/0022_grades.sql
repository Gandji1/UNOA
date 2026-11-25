-- Grades, credits and juries (module GRD): versioned grading policies resolved
-- by scope and programme, append-only grade history (provisional → validated →
-- published through a jury), juries with members and quorum, signed minutes,
-- decisions computed from the policy, credits awarded and capitalised, appeals
-- and rectifications by amendment, transcripts sealed and verifiable.

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('grd.read', 'GRD', 'Consulter notes, jurys et résultats', false),
    ('grd.policy', 'GRD', 'Rédiger et publier les règles de notation', true),
    ('grd.enter', 'GRD', 'Saisir les notes provisoires', false),
    ('grd.validate', 'GRD', 'Valider les notes', true),
    ('grd.jury', 'GRD', 'Constituer les jurys', true),
    ('grd.appeal', 'GRD', 'Instruire les contestations de résultats', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;

INSERT INTO unoa.access_role(code, label, description, level, ordinal) VALUES
    ('exam_officer', 'Gestionnaire des notes et jurys', 'Saisit les notes, constitue les jurys, prépare les délibérations et le calendrier de publication.', 'institution', 127)
ON CONFLICT (code) DO NOTHING;

INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES
    ('institution_admin', 'grd.read'), ('institution_admin', 'grd.policy'), ('institution_admin', 'grd.enter'), ('institution_admin', 'grd.validate'),
    ('institution_admin', 'grd.jury'), ('institution_admin', 'grd.appeal'),
    ('country_admin', 'grd.read'), ('country_admin', 'grd.policy'),
    ('academic_manager', 'grd.read'), ('academic_manager', 'grd.policy'),
    ('dean', 'grd.read'), ('dean', 'grd.validate'), ('dean', 'grd.jury'), ('dean', 'grd.appeal'),
    ('department_head', 'grd.read'), ('department_head', 'grd.enter'), ('department_head', 'grd.validate'),
    ('exam_officer', 'grd.read'), ('exam_officer', 'grd.enter'), ('exam_officer', 'grd.jury'),
    ('registrar_validator', 'grd.read'), ('registrar_validator', 'grd.validate'),
    ('appeals_committee', 'grd.read'), ('appeals_committee', 'grd.appeal'),
    ('auditor', 'grd.read')
) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.access_role WHERE code = item.role)
ON CONFLICT DO NOTHING;

INSERT INTO unoa.notification_event(code, module, variables, sensitive) VALUES
    ('grd.results_published', 'GRD', '{jury,period}', false),
    ('grd.appeal_decided', 'GRD', '{jury,outcome}', true),
    ('grd.rectified', 'GRD', '{jury}', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE unoa.grading_policy (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    program_version_id uuid REFERENCES unoa.program_version(id),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
    scale_max numeric(7, 2) NOT NULL CHECK (scale_max > 0 AND scale_max <= 1000),
    pass_mark numeric(7, 2) NOT NULL,
    unit_pass_mark numeric(7, 2) NOT NULL,
    rounding text NOT NULL CHECK (rounding IN ('half_up', 'half_even', 'down', 'up')),
    decimals integer NOT NULL CHECK (decimals BETWEEN 0 AND 3),
    compensation boolean NOT NULL,
    compensation_floor numeric(7, 2),
    resit boolean NOT NULL,
    resit_rule text NOT NULL CHECK (resit_rule IN ('best', 'replace')),
    jury_quorum integer NOT NULL CHECK (jury_quorum BETWEEN 1 AND 50),
    appeal_days integer NOT NULL CHECK (appeal_days BETWEEN 0 AND 120),
    effective_from date NOT NULL,
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'retired')),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    publisher_id uuid REFERENCES unoa.account(id),
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (pass_mark BETWEEN 0 AND scale_max AND unit_pass_mark BETWEEN 0 AND scale_max),
    CHECK (NOT compensation OR (compensation_floor IS NOT NULL AND compensation_floor BETWEEN 0 AND unit_pass_mark)),
    CHECK ((state = 'draft') = (publisher_id IS NULL)),
    CHECK (publisher_id IS NULL OR publisher_id <> author_id)
);
CREATE UNIQUE INDEX grading_policy_date ON unoa.grading_policy(scope_id, coalesce(program_version_id, '00000000-0000-0000-0000-000000000000'), effective_from) WHERE state = 'published';
-- A published rule set is never rewritten; it can only be retired (GRD-001, GRD-015).
CREATE FUNCTION unoa.validate_grading_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A grading policy is kept' USING ERRCODE = '23514'; END IF;
    IF OLD.state <> 'draft' AND (ROW(NEW.scope_id, NEW.program_version_id, NEW.label, NEW.scale_max, NEW.pass_mark, NEW.unit_pass_mark, NEW.rounding, NEW.decimals,
        NEW.compensation, NEW.compensation_floor, NEW.resit, NEW.resit_rule, NEW.jury_quorum, NEW.appeal_days, NEW.effective_from, NEW.author_id, NEW.publisher_id)
        IS DISTINCT FROM ROW(OLD.scope_id, OLD.program_version_id, OLD.label, OLD.scale_max, OLD.pass_mark, OLD.unit_pass_mark, OLD.rounding, OLD.decimals,
        OLD.compensation, OLD.compensation_floor, OLD.resit, OLD.resit_rule, OLD.jury_quorum, OLD.appeal_days, OLD.effective_from, OLD.author_id, OLD.publisher_id)
        OR (OLD.state = 'retired' AND NEW.state <> 'retired') OR (OLD.state = 'published' AND NEW.state NOT IN ('published', 'retired'))) THEN
        RAISE EXCEPTION 'A published grading policy is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_grading_policy BEFORE UPDATE OR DELETE ON unoa.grading_policy FOR EACH ROW EXECUTE FUNCTION unoa.validate_grading_policy();

-- The rule set in force for a cohort at a date: one written for its programme
-- version first, else the nearest scope above the cohort's owner (inheritance).
CREATE FUNCTION unoa.grading_policy_for(target uuid, at date) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, unoa, pg_temp
AS $$
    WITH RECURSIVE cohort_row AS (SELECT version_id, owner_scope_id FROM unoa.cohort WHERE id = target),
    ancestry AS (
        SELECT scope.id, scope.parent_id, 0 AS depth FROM unoa.scope JOIN cohort_row ON scope.id = cohort_row.owner_scope_id
        UNION ALL SELECT scope.id, scope.parent_id, ancestry.depth + 1 FROM unoa.scope JOIN ancestry ON scope.id = ancestry.parent_id
    )
    SELECT policy.id FROM unoa.grading_policy AS policy
    LEFT JOIN ancestry ON ancestry.id = policy.scope_id
    WHERE policy.state = 'published' AND policy.effective_from <= at
      AND ((policy.program_version_id = (SELECT version_id FROM cohort_row) AND policy.scope_id IN (SELECT id FROM ancestry))
        OR (policy.program_version_id IS NULL AND ancestry.id IS NOT NULL))
    ORDER BY (policy.program_version_id IS NOT NULL) DESC, ancestry.depth, policy.effective_from DESC
    LIMIT 1;
$$;

CREATE TABLE unoa.jury (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    cohort_id uuid NOT NULL REFERENCES unoa.cohort(id),
    period_id uuid NOT NULL REFERENCES unoa.program_period(id),
    session text NOT NULL CHECK (session IN ('first', 'resit')),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
    policy_id uuid NOT NULL REFERENCES unoa.grading_policy(id),
    quorum integer NOT NULL CHECK (quorum >= 1),
    publish_at timestamptz NOT NULL,
    state text NOT NULL DEFAULT 'constituted' CHECK (state IN ('constituted', 'deliberated', 'published')),
    minutes text CHECK (minutes IS NULL OR length(btrim(minutes)) BETWEEN 1 AND 20000),
    minutes_sha256 text CHECK (minutes_sha256 IS NULL OR minutes_sha256 ~ '^[0-9a-f]{64}$'),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    deliberated_at timestamptz,
    published_at timestamptz,
    UNIQUE (cohort_id, period_id, session),
    CHECK ((state = 'constituted') = (deliberated_at IS NULL)),
    CHECK ((state = 'published') = (published_at IS NOT NULL)),
    CHECK (state = 'constituted' OR minutes_sha256 IS NOT NULL)
);
CREATE FUNCTION unoa.validate_jury() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A jury is kept' USING ERRCODE = '23514'; END IF;
    IF OLD.state <> 'constituted' AND ROW(NEW.cohort_id, NEW.period_id, NEW.session, NEW.policy_id, NEW.quorum, NEW.minutes, NEW.minutes_sha256, NEW.deliberated_at)
        IS DISTINCT FROM ROW(OLD.cohort_id, OLD.period_id, OLD.session, OLD.policy_id, OLD.quorum, OLD.minutes, OLD.minutes_sha256, OLD.deliberated_at) THEN
        RAISE EXCEPTION 'A deliberation is changed only by amendment' USING ERRCODE = '23514';
    END IF;
    IF OLD.state = 'published' AND NEW.state <> 'published' THEN RAISE EXCEPTION 'Published results stay published' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_jury BEFORE UPDATE OR DELETE ON unoa.jury FOR EACH ROW EXECUTE FUNCTION unoa.validate_jury();

CREATE TABLE unoa.jury_member (
    jury_id uuid NOT NULL REFERENCES unoa.jury(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    role text NOT NULL CHECK (role IN ('president', 'member')),
    present boolean,
    added_by uuid NOT NULL REFERENCES unoa.account(id),
    PRIMARY KEY (jury_id, account_id)
);
CREATE UNIQUE INDEX jury_one_president ON unoa.jury_member(jury_id) WHERE role = 'president';

CREATE TABLE unoa.rectification (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    jury_id uuid NOT NULL REFERENCES unoa.jury(id),
    registration_id uuid NOT NULL REFERENCES unoa.registration(id),
    appeal_id uuid,
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 4000),
    decided_by uuid NOT NULL REFERENCES unoa.account(id),
    sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Grade history: every entry is a new row (GRD-012); the latest row per
-- registration, unit and session is the current grade.
CREATE TABLE unoa.grade_entry (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id uuid NOT NULL REFERENCES unoa.registration(id),
    unit_id uuid NOT NULL REFERENCES unoa.teaching_unit(id),
    session text NOT NULL CHECK (session IN ('first', 'resit')),
    mark numeric(7, 2) CHECK (mark IS NULL OR mark >= 0),
    absence text NOT NULL DEFAULT 'none' CHECK (absence IN ('none', 'justified', 'unjustified')),
    state text NOT NULL CHECK (state IN ('provisional', 'validated')),
    reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 1000),
    supersedes uuid REFERENCES unoa.grade_entry(id),
    rectification_id uuid REFERENCES unoa.rectification(id),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((absence = 'none') = (mark IS NOT NULL))
);
CREATE INDEX grade_entry_current ON unoa.grade_entry(registration_id, unit_id, session, created_at DESC);
CREATE TRIGGER grade_entry_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.grade_entry FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
CREATE FUNCTION unoa.validate_grade_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    previous unoa.grade_entry%ROWTYPE;
    scale numeric;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM unoa.course_registration WHERE registration_id = NEW.registration_id AND unit_id = NEW.unit_id AND state <> 'withdrawn') THEN
        RAISE EXCEPTION 'The student is not registered to this unit' USING ERRCODE = '23514';
    END IF;
    SELECT policy.scale_max INTO scale FROM unoa.registration JOIN unoa.grading_policy AS policy
        ON policy.id = unoa.grading_policy_for(registration.cohort_id, current_date) WHERE registration.id = NEW.registration_id;
    IF scale IS NULL THEN RAISE EXCEPTION 'No grading policy in force' USING ERRCODE = '23514'; END IF;
    IF NEW.mark > scale THEN RAISE EXCEPTION 'Mark above the scale' USING ERRCODE = '23514'; END IF;
    SELECT * INTO previous FROM unoa.grade_entry WHERE registration_id = NEW.registration_id AND unit_id = NEW.unit_id AND session = NEW.session
        ORDER BY created_at DESC LIMIT 1;
    IF NEW.state = 'validated' AND NEW.rectification_id IS NULL THEN
        IF previous.id IS NULL OR previous.id IS DISTINCT FROM NEW.supersedes OR previous.state <> 'provisional'
            OR previous.mark IS DISTINCT FROM NEW.mark OR previous.absence <> NEW.absence THEN
            RAISE EXCEPTION 'Validation confirms the current provisional grade' USING ERRCODE = '23514';
        END IF;
        IF previous.author_id = NEW.author_id THEN
            RAISE EXCEPTION 'A grade is validated by another person than its author' USING ERRCODE = 'U0403';
        END IF;
    END IF;
    -- After publication, a result changes only through a rectification (GRD-011, GRD-015).
    IF NEW.rectification_id IS NULL AND EXISTS (
        SELECT 1 FROM unoa.jury JOIN unoa.registration ON registration.cohort_id = jury.cohort_id
        JOIN unoa.teaching_unit AS unit ON unit.period_id = jury.period_id
        WHERE registration.id = NEW.registration_id AND unit.id = NEW.unit_id AND jury.session = NEW.session AND jury.state <> 'constituted') THEN
        RAISE EXCEPTION 'Deliberated grades change only by rectification' USING ERRCODE = 'U0409';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_grade_entry BEFORE INSERT ON unoa.grade_entry FOR EACH ROW EXECUTE FUNCTION unoa.validate_grade_entry();

CREATE TABLE unoa.jury_decision (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    jury_id uuid NOT NULL REFERENCES unoa.jury(id),
    registration_id uuid NOT NULL REFERENCES unoa.registration(id),
    average numeric(7, 3),
    outcome text NOT NULL CHECK (outcome IN ('admitted', 'compensated', 'resit', 'failed', 'incomplete')),
    credits numeric(8, 2) NOT NULL CHECK (credits >= 0),
    units jsonb NOT NULL CHECK (jsonb_typeof(units) = 'array'),
    policy_id uuid NOT NULL REFERENCES unoa.grading_policy(id),
    amends uuid REFERENCES unoa.jury_decision(id),
    rectification_id uuid REFERENCES unoa.rectification(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((amends IS NULL) = (rectification_id IS NULL))
);
CREATE UNIQUE INDEX jury_decision_original ON unoa.jury_decision(jury_id, registration_id) WHERE amends IS NULL;
CREATE TRIGGER jury_decision_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.jury_decision FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.jury_signature (
    jury_id uuid NOT NULL REFERENCES unoa.jury(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    rectification_id uuid REFERENCES unoa.rectification(id),
    signed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (jury_id, account_id, sha256)
);
CREATE TRIGGER jury_signature_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.jury_signature FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
CREATE TRIGGER rectification_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.rectification FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Credits: one award in force per student and unit, kept across years (capitalisation).
CREATE TABLE unoa.credit_award (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid NOT NULL REFERENCES unoa.student(id),
    unit_id uuid NOT NULL REFERENCES unoa.teaching_unit(id),
    credits numeric(8, 2) NOT NULL CHECK (credits > 0),
    mode text NOT NULL CHECK (mode IN ('earned', 'compensated')),
    decision_id uuid NOT NULL REFERENCES unoa.jury_decision(id),
    awarded_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    revoked_by uuid REFERENCES unoa.rectification(id),
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE UNIQUE INDEX credit_award_active ON unoa.credit_award(student_id, unit_id) WHERE revoked_at IS NULL;
CREATE FUNCTION unoa.validate_credit_award() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' OR OLD.revoked_at IS NOT NULL OR ROW(NEW.student_id, NEW.unit_id, NEW.credits, NEW.mode, NEW.decision_id, NEW.awarded_at)
        IS DISTINCT FROM ROW(OLD.student_id, OLD.unit_id, OLD.credits, OLD.mode, OLD.decision_id, OLD.awarded_at) THEN
        RAISE EXCEPTION 'A credit award is only revoked by rectification' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_credit_award BEFORE UPDATE OR DELETE ON unoa.credit_award FOR EACH ROW EXECUTE FUNCTION unoa.validate_credit_award();
CREATE FUNCTION unoa.check_credit_award() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF NEW.credits > (SELECT credits FROM unoa.teaching_unit WHERE id = NEW.unit_id) THEN
        RAISE EXCEPTION 'Credits above the unit value' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER check_credit_award BEFORE INSERT ON unoa.credit_award FOR EACH ROW EXECUTE FUNCTION unoa.check_credit_award();

CREATE TABLE unoa.grade_appeal (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id uuid NOT NULL REFERENCES unoa.jury_decision(id),
    appellant_id uuid NOT NULL REFERENCES unoa.account(id),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 4000),
    filed_at timestamptz NOT NULL DEFAULT now(),
    state text NOT NULL DEFAULT 'filed' CHECK (state IN ('filed', 'rejected', 'upheld')),
    response text CHECK (response IS NULL OR length(btrim(response)) BETWEEN 1 AND 4000),
    decided_by uuid REFERENCES unoa.account(id),
    decided_at timestamptz,
    CHECK ((state = 'filed') = (decided_by IS NULL)),
    CHECK (state = 'filed' OR response IS NOT NULL),
    CHECK (decided_by IS NULL OR decided_by <> appellant_id)
);
CREATE UNIQUE INDEX grade_appeal_open ON unoa.grade_appeal(decision_id) WHERE state = 'filed';
ALTER TABLE unoa.rectification ADD FOREIGN KEY (appeal_id) REFERENCES unoa.grade_appeal(id);

CREATE TABLE unoa.transcript (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid NOT NULL REFERENCES unoa.student(id),
    content jsonb NOT NULL,
    sha256 text NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    issued_by uuid NOT NULL REFERENCES unoa.account(id),
    issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER transcript_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.transcript FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
