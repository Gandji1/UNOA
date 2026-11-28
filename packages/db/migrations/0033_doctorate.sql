-- Doctorate (module PHD), built on theses and defences (0032): doctoral schools
-- and laboratories, scientific application with funding, admission decided by
-- another person, directors authorised to supervise research, individual
-- monitoring committee, yearly re-enrolment within the configured duration,
-- annual reports and committee decisions, doctoral training, publications,
-- ethics review, authorisation to defend, then the shared jury, defence,
-- minutes and archive. No doctoral diploma is produced here: diplomas go
-- through the document register, locked without a verified authorisation.

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('phd.read', 'PHD', 'Consulter le doctorat', false),
    ('phd.manage', 'PHD', 'Gérer écoles doctorales, laboratoires, inscriptions et formations', false),
    ('phd.decide', 'PHD', 'Décider des admissions en doctorat', true),
    ('phd.direct', 'PHD', 'Diriger des recherches (habilitation)', false),
    ('phd.authorize', 'PHD', 'Autoriser les soutenances de thèse', true),
    ('phd.ethics', 'PHD', 'Enregistrer les avis éthiques', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;

INSERT INTO unoa.access_role(code, label, description, level, ordinal) VALUES
    ('doctoral_school_director', 'Directeur d’école doctorale', 'Gère l’école doctorale, décide des admissions et autorise les soutenances.', 'institution', 135),
    ('research_director', 'Directeur de recherche habilité', 'Habilité à diriger des thèses.', 'institution', 136)
ON CONFLICT (code) DO NOTHING;

INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES
    ('doctoral_school_director', 'phd.read'), ('doctoral_school_director', 'phd.manage'), ('doctoral_school_director', 'phd.decide'), ('doctoral_school_director', 'phd.authorize'),
    ('doctoral_school_director', 'thesis.read'), ('doctoral_school_director', 'thesis.manage'),
    ('research_director', 'phd.read'), ('research_director', 'phd.direct'), ('research_director', 'thesis.read'),
    ('institution_admin', 'phd.read'), ('auditor', 'phd.read')
) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.access_role WHERE code = item.role)
ON CONFLICT DO NOTHING;

INSERT INTO unoa.notification_event(code, module, variables, sensitive) VALUES
    ('phd.admission', 'PHD', '{title,decision}', true),
    ('phd.review', 'PHD', '{year,decision}', true),
    ('phd.authorized', 'PHD', '{title}', false)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE unoa.doctoral_school (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    director_id uuid REFERENCES unoa.account(id),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (scope_id, name)
);
CREATE TABLE unoa.doctoral_lab (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES unoa.doctoral_school(id),
    code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    head_id uuid REFERENCES unoa.account(id),
    UNIQUE (school_id, code)
);

CREATE TABLE unoa.doctoral_application (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES unoa.doctoral_school(id),
    lab_id uuid NOT NULL REFERENCES unoa.doctoral_lab(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
    dossier text NOT NULL CHECK (length(btrim(dossier)) BETWEEN 1 AND 20000),
    funding text CHECK (funding IS NULL OR length(btrim(funding)) BETWEEN 1 AND 2000),
    proposed_director_id uuid NOT NULL REFERENCES unoa.account(id),
    state text NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted', 'accepted', 'rejected')),
    funding_status text NOT NULL DEFAULT 'none' CHECK (funding_status IN ('none', 'validated', 'refused')),
    decided_by uuid REFERENCES unoa.account(id),
    decision_note text CHECK (decision_note IS NULL OR length(btrim(decision_note)) BETWEEN 1 AND 2000),
    project_id uuid REFERENCES unoa.thesis_project(id),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz,
    CHECK (decided_by IS NULL OR decided_by <> account_id),
    CHECK ((state = 'submitted') = (decided_by IS NULL)),
    CHECK ((state = 'accepted') = (project_id IS NOT NULL)),
    CHECK (state <> 'rejected' OR decision_note IS NOT NULL)
);

CREATE TABLE unoa.doctoral_project (
    project_id uuid PRIMARY KEY REFERENCES unoa.thesis_project(id),
    school_id uuid NOT NULL REFERENCES unoa.doctoral_school(id),
    lab_id uuid NOT NULL REFERENCES unoa.doctoral_lab(id),
    funding text,
    ethics_needed boolean NOT NULL DEFAULT false,
    started_on date NOT NULL
);

CREATE TABLE unoa.doctoral_enrollment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES unoa.thesis_project(id),
    academic_year text NOT NULL CHECK (academic_year ~ '^[0-9]{4}-[0-9]{4}$'),
    valid_from date NOT NULL,
    valid_until date NOT NULL,
    enrolled_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, academic_year),
    CHECK (valid_until > valid_from)
);
CREATE TRIGGER doctoral_enrollment_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.doctoral_enrollment FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.committee_member (
    project_id uuid NOT NULL REFERENCES unoa.thesis_project(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    added_by uuid NOT NULL REFERENCES unoa.account(id),
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, account_id)
);
-- The monitoring committee is independent from the author and the supervisors.
CREATE FUNCTION unoa.check_committee_member() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM unoa.thesis_project WHERE id = NEW.project_id AND author_id = NEW.account_id)
        OR EXISTS (SELECT 1 FROM unoa.supervision WHERE project_id = NEW.project_id AND account_id = NEW.account_id AND ended_at IS NULL) THEN
        RAISE EXCEPTION 'The monitoring committee is independent from the author and supervisors' USING ERRCODE = 'U0403';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER check_committee_member BEFORE INSERT ON unoa.committee_member FOR EACH ROW EXECUTE FUNCTION unoa.check_committee_member();

CREATE TABLE unoa.progress_review (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES unoa.thesis_project(id),
    academic_year text NOT NULL CHECK (academic_year ~ '^[0-9]{4}-[0-9]{4}$'),
    report text NOT NULL CHECK (length(btrim(report)) BETWEEN 1 AND 20000),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    opinion text CHECK (opinion IS NULL OR length(btrim(opinion)) BETWEEN 1 AND 8000),
    decision text CHECK (decision IS NULL OR decision IN ('continue', 'continue_with_conditions', 'stop')),
    decided_by uuid REFERENCES unoa.account(id),
    decided_at timestamptz,
    UNIQUE (project_id, academic_year),
    CHECK ((decision IS NULL) = (decided_by IS NULL) AND (decision IS NULL) = (opinion IS NULL))
);

CREATE TABLE unoa.doctoral_training (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES unoa.thesis_project(id),
    kind text NOT NULL CHECK (kind IN ('course', 'seminar', 'school', 'other')),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
    hours integer NOT NULL CHECK (hours BETWEEN 1 AND 500),
    evidence text NOT NULL CHECK (length(btrim(evidence)) BETWEEN 1 AND 1000),
    validated_by uuid REFERENCES unoa.account(id),
    validated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((validated_by IS NULL) = (validated_at IS NULL))
);

CREATE TABLE unoa.publication (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES unoa.thesis_project(id),
    kind text NOT NULL CHECK (kind IN ('article', 'conference', 'poster', 'book', 'other')),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 400),
    venue text NOT NULL CHECK (length(btrim(venue)) BETWEEN 1 AND 300),
    year integer NOT NULL CHECK (year BETWEEN 1900 AND 2200),
    status text NOT NULL CHECK (status IN ('submitted', 'accepted', 'published')),
    doi text CHECK (doi IS NULL OR doi ~ '^10\.[0-9]{4,9}/\S+$'),
    recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unoa.ethics_review (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES unoa.thesis_project(id),
    committee text NOT NULL CHECK (length(btrim(committee)) BETWEEN 1 AND 200),
    reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 120),
    decision text NOT NULL CHECK (decision IN ('approved', 'conditions', 'refused')),
    note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 4000),
    recorded_by uuid NOT NULL REFERENCES unoa.account(id),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER ethics_review_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.ethics_review FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Personal spaces now include theses and the doctorate.
CREATE OR REPLACE FUNCTION unoa.account_spaces(actor uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT array_remove(ARRAY[
        CASE WHEN EXISTS (SELECT 1 FROM unoa.offering_member WHERE account_id = actor AND role = 'learner' AND removed_at IS NULL) THEN 'learning' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.offering_member WHERE account_id = actor AND role IN ('teacher', 'tutor') AND removed_at IS NULL)
               OR EXISTS (SELECT 1 FROM unoa.teacher_profile WHERE account_id = actor)
               OR EXISTS (SELECT 1 FROM unoa.teacher_application WHERE applicant_id = actor) THEN 'teaching' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.application WHERE applicant_id = actor) THEN 'admission' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.student WHERE account_id = actor) THEN 'student' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.invoice WHERE account_id = actor) THEN 'finance' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.credential WHERE holder_id = actor) THEN 'documents' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.short_enrollment WHERE account_id = actor) THEN 'short' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.external_participation WHERE account_id = actor) THEN 'external' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.council_member WHERE account_id = actor) THEN 'councils' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.thesis_project WHERE author_id = actor)
               OR EXISTS (SELECT 1 FROM unoa.supervision WHERE account_id = actor AND ended_at IS NULL)
               OR EXISTS (SELECT 1 FROM unoa.defense_member WHERE account_id = actor) THEN 'thesis' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.doctoral_application WHERE account_id = actor) THEN 'doctorate' END
    ], NULL);
$$;
