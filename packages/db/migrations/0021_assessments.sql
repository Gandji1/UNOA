-- Internal assessments (module ASS): versioned question banks, assessments of a
-- course offering (individual or team), windows, attempts, draws, documented
-- accommodations, drafts, server receipts, idempotent submission, automatic
-- scoring where suitable, human grading, double grading and moderation,
-- integrity cases heard contradictorily, archived copies.

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('ass.read', 'ASS', 'Consulter les évaluations', false),
    ('ass.author', 'ASS', 'Créer banques de questions et épreuves', false),
    ('ass.grade', 'ASS', 'Corriger les copies', false),
    ('ass.moderate', 'ASS', 'Modérer les doubles corrections', true),
    ('ass.integrity', 'ASS', 'Instruire les suspicions de fraude', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;

INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES
    ('institution_admin', 'ass.read'), ('institution_admin', 'ass.author'), ('institution_admin', 'ass.grade'), ('institution_admin', 'ass.moderate'), ('institution_admin', 'ass.integrity'),
    ('country_admin', 'ass.read'), ('country_admin', 'ass.author'), ('country_admin', 'ass.grade'), ('country_admin', 'ass.moderate'), ('country_admin', 'ass.integrity'),
    ('dean', 'ass.read'), ('dean', 'ass.moderate'), ('dean', 'ass.integrity'),
    ('department_head', 'ass.read'), ('department_head', 'ass.author'), ('department_head', 'ass.grade'), ('department_head', 'ass.moderate'),
    ('teacher', 'ass.read'), ('teacher', 'ass.author'), ('teacher', 'ass.grade'),
    ('pedagogical_reviewer', 'ass.read'), ('auditor', 'ass.read')
) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.access_role WHERE code = item.role)
ON CONFLICT DO NOTHING;

INSERT INTO unoa.notification_event(code, module, variables, sensitive) VALUES
    ('ass.published', 'ASS', '{title,course,opens,closes}', false),
    ('ass.receipt', 'ASS', '{title,receipt}', false),
    ('ass.graded', 'ASS', '{title}', false),
    ('ass.integrity', 'ASS', '{title}', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE unoa.question_bank (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unoa.question (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id uuid NOT NULL REFERENCES unoa.question_bank(id),
    lineage uuid NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    kind text NOT NULL CHECK (kind IN ('single', 'multiple', 'matching', 'numeric', 'text', 'code', 'file')),
    prompt text NOT NULL CHECK (length(btrim(prompt)) BETWEEN 1 AND 6000),
    choices jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(choices) = 'array'),
    answer jsonb,
    points numeric(7, 2) NOT NULL CHECK (points > 0),
    tags text CHECK (tags IS NULL OR length(tags) <= 200),
    retired_at timestamptz,
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (lineage, version)
);
-- A question version is never rewritten: a change creates the next version.
CREATE FUNCTION unoa.validate_question() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' OR ROW(NEW.bank_id, NEW.lineage, NEW.version, NEW.kind, NEW.prompt, NEW.choices, NEW.answer, NEW.points, NEW.author_id)
        IS DISTINCT FROM ROW(OLD.bank_id, OLD.lineage, OLD.version, OLD.kind, OLD.prompt, OLD.choices, OLD.answer, OLD.points, OLD.author_id) THEN
        RAISE EXCEPTION 'A question version is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_question BEFORE UPDATE OR DELETE ON unoa.question FOR EACH ROW EXECUTE FUNCTION unoa.validate_question();

CREATE TABLE unoa.assessment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    offering_id uuid NOT NULL REFERENCES unoa.course_offering(id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    kind text NOT NULL CHECK (kind IN ('quiz', 'assignment', 'exam')),
    team boolean NOT NULL DEFAULT false,
    instructions text CHECK (instructions IS NULL OR length(instructions) <= 6000),
    opens_at timestamptz NOT NULL,
    closes_at timestamptz NOT NULL,
    duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 600),
    attempts_allowed integer NOT NULL DEFAULT 1 CHECK (attempts_allowed BETWEEN 1 AND 20),
    draw_count integer CHECK (draw_count IS NULL OR draw_count > 0),
    rubric jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(rubric) = 'array'),
    double_grading boolean NOT NULL DEFAULT false,
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'closed')),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    CHECK (closes_at > opens_at)
);
CREATE INDEX assessment_offering ON unoa.assessment(offering_id);

CREATE TABLE unoa.assessment_question (
    assessment_id uuid NOT NULL REFERENCES unoa.assessment(id),
    question_id uuid NOT NULL REFERENCES unoa.question(id),
    ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 500),
    PRIMARY KEY (assessment_id, question_id)
);
-- The subject is frozen once published (no silent change after learners saw it).
CREATE FUNCTION unoa.freeze_assessment_subject() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM unoa.assessment WHERE id = coalesce(NEW.assessment_id, OLD.assessment_id) AND state <> 'draft') THEN
        RAISE EXCEPTION 'A published subject is frozen' USING ERRCODE = '23514';
    END IF;
    RETURN coalesce(NEW, OLD);
END;
$$;
CREATE TRIGGER freeze_assessment_subject BEFORE INSERT OR UPDATE OR DELETE ON unoa.assessment_question FOR EACH ROW EXECUTE FUNCTION unoa.freeze_assessment_subject();

CREATE TABLE unoa.accommodation (
    assessment_id uuid NOT NULL REFERENCES unoa.assessment(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    extra_minutes integer NOT NULL DEFAULT 0 CHECK (extra_minutes BETWEEN 0 AND 600),
    extra_days integer NOT NULL DEFAULT 0 CHECK (extra_days BETWEEN 0 AND 60),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    granted_by uuid NOT NULL REFERENCES unoa.account(id),
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (assessment_id, account_id),
    CHECK (extra_minutes > 0 OR extra_days > 0)
);

CREATE TABLE unoa.attempt (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id uuid NOT NULL REFERENCES unoa.assessment(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    number integer NOT NULL CHECK (number > 0),
    team_label text CHECK (team_label IS NULL OR length(btrim(team_label)) BETWEEN 1 AND 120),
    team_members uuid[] NOT NULL DEFAULT '{}',
    questions jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
    answers jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answers) = 'object'),
    started_at timestamptz NOT NULL DEFAULT now(),
    deadline timestamptz NOT NULL,
    saved_at timestamptz,
    state text NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress', 'submitted')),
    submitted_at timestamptz,
    receipt text UNIQUE CHECK (receipt IS NULL OR receipt ~ '^[0-9a-f]{64}$'),
    auto_score numeric(8, 2),
    UNIQUE (assessment_id, account_id, number),
    CHECK ((state = 'submitted') = (submitted_at IS NOT NULL AND receipt IS NOT NULL))
);
CREATE UNIQUE INDEX attempt_team ON unoa.attempt(assessment_id, team_label, number) WHERE team_label IS NOT NULL;
CREATE INDEX attempt_members ON unoa.attempt USING gin (team_members);
-- A submitted copy is never rewritten (ASS-010, ASS-015).
CREATE FUNCTION unoa.validate_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' OR (OLD.state = 'submitted' AND ROW(NEW.team_members, NEW.answers, NEW.state, NEW.submitted_at, NEW.receipt, NEW.auto_score)
        IS DISTINCT FROM ROW(OLD.team_members, OLD.answers, OLD.state, OLD.submitted_at, OLD.receipt, OLD.auto_score)) THEN
        RAISE EXCEPTION 'A submitted copy is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_attempt BEFORE UPDATE OR DELETE ON unoa.attempt FOR EACH ROW EXECUTE FUNCTION unoa.validate_attempt();

CREATE TABLE unoa.attempt_file (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id uuid NOT NULL REFERENCES unoa.attempt(id),
    question_id uuid NOT NULL REFERENCES unoa.question(id),
    filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
    format text NOT NULL CHECK (format IN ('pdf', 'png', 'jpg')),
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    content bytea NOT NULL,
    uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER attempt_file_kept BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.attempt_file FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.grading (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id uuid NOT NULL REFERENCES unoa.attempt(id),
    round text NOT NULL CHECK (round IN ('first', 'second', 'moderation')),
    grader_id uuid NOT NULL REFERENCES unoa.account(id),
    scores jsonb NOT NULL CHECK (jsonb_typeof(scores) = 'object'),
    total numeric(8, 2) NOT NULL CHECK (total >= 0),
    feedback text CHECK (feedback IS NULL OR length(feedback) <= 8000),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, round)
);
CREATE TRIGGER grading_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.grading FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
-- Second grading and moderation come from other people.
CREATE FUNCTION unoa.validate_grading() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM unoa.attempt WHERE id = NEW.attempt_id AND state = 'submitted') THEN
        RAISE EXCEPTION 'Only a submitted copy is graded' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM unoa.attempt WHERE id = NEW.attempt_id AND account_id = NEW.grader_id) THEN
        RAISE EXCEPTION 'A learner does not grade their own copy' USING ERRCODE = 'U0403';
    END IF;
    IF NEW.round <> 'first' AND EXISTS (SELECT 1 FROM unoa.grading WHERE attempt_id = NEW.attempt_id AND grader_id = NEW.grader_id) THEN
        RAISE EXCEPTION 'Double grading and moderation by different people' USING ERRCODE = 'U0403';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_grading BEFORE INSERT ON unoa.grading FOR EACH ROW EXECUTE FUNCTION unoa.validate_grading();

CREATE TABLE unoa.integrity_case (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id uuid NOT NULL REFERENCES unoa.attempt(id),
    reported_by uuid NOT NULL REFERENCES unoa.account(id),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 4000),
    reported_at timestamptz NOT NULL DEFAULT now(),
    state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'answered', 'dismissed', 'sanctioned')),
    learner_response text CHECK (learner_response IS NULL OR length(btrim(learner_response)) BETWEEN 1 AND 4000),
    answered_at timestamptz,
    decision text CHECK (decision IS NULL OR length(btrim(decision)) BETWEEN 1 AND 4000),
    decided_by uuid REFERENCES unoa.account(id),
    decided_at timestamptz,
    CHECK (decided_by IS NULL OR decided_by <> reported_by),
    CHECK (state NOT IN ('dismissed', 'sanctioned') OR decision IS NOT NULL)
);
