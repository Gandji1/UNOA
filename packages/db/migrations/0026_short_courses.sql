-- Short courses (module SHORT): non-degree training of any length, free
-- modules with competencies, sessions with price and modality, enrolment of
-- the public and of client companies' employees, reuse of validated content
-- under licence, progress recorded with evidence by trainers, private
-- attestations and stackable micro-certifications through the document
-- register (CRED), recognition of prior learning decided by a person,
-- participation and satisfaction reports.

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('short.read', 'SHORT', 'Consulter les formations courtes', false),
    ('short.manage', 'SHORT', 'Concevoir formations courtes, sessions et parcours', false),
    ('short.approve', 'SHORT', 'Approuver la publication des formations courtes', false),
    ('short.train', 'SHORT', 'Animer et valider la progression des apprenants', false),
    ('short.clients', 'SHORT', 'Gérer les clients entreprises et leurs inscriptions', true),
    ('short.rpl', 'SHORT', 'Instruire les demandes de reconnaissance des acquis', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;

INSERT INTO unoa.access_role(code, label, description, level, ordinal) VALUES
    ('short_manager', 'Responsable des formations courtes', 'Conçoit les formations courtes, modules, sessions, parcours et clients entreprises.', 'institution', 133),
    ('trainer', 'Formateur', 'Anime les sessions et valide la progression des apprenants avec preuve.', 'institution', 134)
ON CONFLICT (code) DO NOTHING;

INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES
    ('short_manager', 'short.read'), ('short_manager', 'short.manage'), ('short_manager', 'short.clients'), ('short_manager', 'short.rpl'),
    ('trainer', 'short.read'), ('trainer', 'short.train'),
    ('institution_admin', 'short.read'), ('institution_admin', 'short.approve'), ('academic_manager', 'short.read'), ('academic_manager', 'short.approve'),
    ('auditor', 'short.read')
) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.access_role WHERE code = item.role)
ON CONFLICT DO NOTHING;

INSERT INTO unoa.notification_event(code, module, variables, sensitive) VALUES
    ('short.enrolled', 'SHORT', '{course,session}', false),
    ('short.completed', 'SHORT', '{course}', false),
    ('short.rpl_decided', 'SHORT', '{target,decision}', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE unoa.short_course (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 6000),
    audience text CHECK (audience IS NULL OR length(btrim(audience)) BETWEEN 1 AND 500),
    duration_hours numeric(7, 2) NOT NULL CHECK (duration_hours > 0 AND duration_hours <= 5000),
    competencies text[] NOT NULL DEFAULT '{}' CHECK (cardinality(competencies) <= 30),
    pass_threshold integer NOT NULL CHECK (pass_threshold BETWEEN 0 AND 100),
    credential_type_id uuid REFERENCES unoa.credential_type(id),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'archived')),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    publisher_id uuid REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (scope_id, code),
    CHECK ((state = 'draft') = (publisher_id IS NULL)),
    CHECK (publisher_id IS NULL OR publisher_id <> author_id)
);

CREATE TABLE unoa.short_module (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id uuid NOT NULL REFERENCES unoa.short_course(id),
    ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 200),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    hours numeric(7, 2) NOT NULL CHECK (hours > 0),
    competencies text[] NOT NULL DEFAULT '{}' CHECK (cardinality(competencies) <= 30),
    -- Reused validated content (SHORT-005): a published course version, under a stated licence.
    content_version_id uuid REFERENCES unoa.course_version(id),
    licence text CHECK (licence IS NULL OR length(btrim(licence)) BETWEEN 1 AND 500),
    UNIQUE (course_id, ordinal),
    CHECK (content_version_id IS NULL OR licence IS NOT NULL)
);
CREATE FUNCTION unoa.validate_short_module() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF NEW.content_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unoa.course_version WHERE id = NEW.content_version_id AND state = 'published') THEN
        RAISE EXCEPTION 'Only validated (published) content is reused' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM unoa.short_course WHERE id = NEW.course_id AND state <> 'draft') THEN
        RAISE EXCEPTION 'A published short course keeps its modules' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_short_module BEFORE INSERT OR UPDATE ON unoa.short_module FOR EACH ROW EXECUTE FUNCTION unoa.validate_short_module();

CREATE TABLE unoa.short_client (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    registration text CHECK (registration IS NULL OR length(btrim(registration)) BETWEEN 1 AND 80),
    contact_account_id uuid NOT NULL REFERENCES unoa.account(id),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (scope_id, name)
);

CREATE TABLE unoa.training_session (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id uuid NOT NULL REFERENCES unoa.short_course(id),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
    modality text NOT NULL CHECK (modality IN ('online', 'onsite', 'hybrid')),
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    capacity integer CHECK (capacity IS NULL OR capacity > 0),
    price_rule_id uuid REFERENCES unoa.price_rule(id),
    client_id uuid REFERENCES unoa.short_client(id),
    trainer_id uuid REFERENCES unoa.account(id),
    state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_on >= starts_on)
);

CREATE TABLE unoa.short_enrollment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES unoa.training_session(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    client_id uuid REFERENCES unoa.short_client(id),
    invoice_id uuid REFERENCES unoa.invoice(id),
    state text NOT NULL DEFAULT 'enrolled' CHECK (state IN ('enrolled', 'completed', 'not_passed', 'withdrawn')),
    enrolled_by uuid NOT NULL REFERENCES unoa.account(id),
    enrolled_at timestamptz NOT NULL DEFAULT now(),
    concluded_at timestamptz,
    UNIQUE (session_id, account_id),
    CHECK ((state IN ('completed', 'not_passed')) = (concluded_at IS NOT NULL))
);

-- Evidence of each module's result, recorded by a trainer (SHORT-006); append-only.
CREATE TABLE unoa.module_result (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id uuid NOT NULL REFERENCES unoa.short_enrollment(id),
    module_id uuid NOT NULL REFERENCES unoa.short_module(id),
    score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
    evidence text NOT NULL CHECK (length(btrim(evidence)) BETWEEN 1 AND 2000),
    recorded_by uuid NOT NULL REFERENCES unoa.account(id),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX module_result_enrollment ON unoa.module_result(enrollment_id, module_id, recorded_at DESC);
CREATE TRIGGER module_result_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.module_result FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
CREATE FUNCTION unoa.check_module_result() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM unoa.short_enrollment WHERE id = NEW.enrollment_id AND account_id = NEW.recorded_by) THEN
        RAISE EXCEPTION 'A learner does not validate their own progress' USING ERRCODE = 'U0403';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unoa.short_enrollment AS enrollment JOIN unoa.training_session AS session ON session.id = enrollment.session_id
        JOIN unoa.short_module AS module ON module.course_id = session.course_id WHERE enrollment.id = NEW.enrollment_id AND module.id = NEW.module_id AND enrollment.state = 'enrolled') THEN
        RAISE EXCEPTION 'The module belongs to the course of an ongoing enrolment' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER check_module_result BEFORE INSERT ON unoa.module_result FOR EACH ROW EXECUTE FUNCTION unoa.check_module_result();

CREATE TABLE unoa.short_feedback (
    enrollment_id uuid PRIMARY KEY REFERENCES unoa.short_enrollment(id),
    rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment text CHECK (comment IS NULL OR length(btrim(comment)) BETWEEN 1 AND 2000),
    submitted_at timestamptz NOT NULL DEFAULT now()
);

-- Stackable micro-certifications (SHORT-008): a set of short courses leading to a badge.
CREATE TABLE unoa.credential_stack (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    course_ids uuid[] NOT NULL CHECK (cardinality(course_ids) BETWEEN 2 AND 20),
    credential_type_id uuid NOT NULL REFERENCES unoa.credential_type(id),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Recognition of prior learning (SHORT-009): a reasoned human decision, never automatic.
CREATE TABLE unoa.rpl_request (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    course_id uuid REFERENCES unoa.short_course(id),
    target text NOT NULL CHECK (length(btrim(target)) BETWEEN 1 AND 200),
    experience text NOT NULL CHECK (length(btrim(experience)) BETWEEN 1 AND 6000),
    state text NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted', 'in_review', 'accepted', 'partially_accepted', 'rejected')),
    reviewer_id uuid REFERENCES unoa.account(id),
    decision text CHECK (decision IS NULL OR length(btrim(decision)) BETWEEN 1 AND 4000),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz,
    CHECK (reviewer_id IS NULL OR reviewer_id <> account_id),
    CHECK ((state IN ('accepted', 'partially_accepted', 'rejected')) = (decision IS NOT NULL AND decided_at IS NOT NULL))
);
