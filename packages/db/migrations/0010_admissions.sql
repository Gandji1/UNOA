-- Admissions: campaigns on a published programme version, applications from a
-- single account identity, documents, separate reviews, decisions and appeals.
-- An admission never depends on a payment.

CREATE TABLE unoa.admission_round (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id uuid NOT NULL REFERENCES unoa.program_version(id),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
    opens_at timestamptz NOT NULL,
    closes_at timestamptz NOT NULL,
    form jsonb NOT NULL CHECK (jsonb_typeof(form) = 'array'),
    documents jsonb NOT NULL CHECK (jsonb_typeof(documents) = 'array'),
    criteria jsonb NOT NULL CHECK (jsonb_typeof(criteria) = 'array'),
    instructions text CHECK (instructions IS NULL OR length(btrim(instructions)) BETWEEN 1 AND 4000),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'open', 'closed')),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    opened_by uuid REFERENCES unoa.account(id),
    CHECK (closes_at > opens_at)
);

CREATE FUNCTION unoa.validate_admission_round() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    program_id uuid;
BEGIN
    SELECT version.program_id INTO program_id FROM unoa.program_version AS version
    WHERE version.id = NEW.version_id AND version.state = 'published';
    IF TG_OP = 'INSERT' THEN
        IF program_id IS NULL OR NEW.state <> 'draft' THEN
            RAISE EXCEPTION 'A campaign starts as a draft on a published version' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF ROW(NEW.id, NEW.version_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM ROW(OLD.id, OLD.version_id, OLD.created_by, OLD.created_at) THEN
        RAISE EXCEPTION 'The identity of a campaign is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.state <> 'draft' AND ROW(NEW.label, NEW.opens_at, NEW.form, NEW.documents, NEW.criteria, NEW.instructions)
        IS DISTINCT FROM ROW(OLD.label, OLD.opens_at, OLD.form, OLD.documents, OLD.criteria, OLD.instructions) THEN
        RAISE EXCEPTION 'An opened campaign keeps its form and rules' USING ERRCODE = '23514';
    END IF;
    IF OLD.state <> 'draft' AND NEW.closes_at < OLD.closes_at AND NEW.closes_at < statement_timestamp() THEN
        RAISE EXCEPTION 'A campaign is not closed retroactively' USING ERRCODE = '23514';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
        (OLD.state = 'draft' AND NEW.state = 'open') OR (OLD.state = 'open' AND NEW.state = 'closed')
    ) THEN
        RAISE EXCEPTION 'Campaign transition refused' USING ERRCODE = '23514';
    END IF;
    IF NEW.state = 'open' AND OLD.state = 'draft' AND (program_id IS NULL OR NOT unoa.program_admission_allowed(program_id)
        OR NOT EXISTS (SELECT 1 FROM unoa.program_version WHERE id = NEW.version_id AND admission_open)) THEN
        RAISE EXCEPTION 'Admissions are not open for this programme' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_admission_round BEFORE INSERT OR UPDATE ON unoa.admission_round
FOR EACH ROW EXECUTE FUNCTION unoa.validate_admission_round();
CREATE TRIGGER admission_round_kept BEFORE DELETE OR TRUNCATE ON unoa.admission_round
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.application (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id uuid NOT NULL REFERENCES unoa.admission_round(id),
    applicant_id uuid NOT NULL REFERENCES unoa.account(id),
    state text NOT NULL DEFAULT 'draft'
        CHECK (state IN ('draft', 'submitted', 'incomplete', 'review', 'decided', 'accepted', 'declined', 'withdrawn')),
    answers jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answers) = 'object'),
    receipt text UNIQUE CHECK (receipt IS NULL OR receipt ~ '^[A-Z0-9-]{8,40}$'),
    submitted_at timestamptz,
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    decision text CHECK (decision IS NULL OR decision IN ('admitted', 'conditional', 'waitlisted', 'refused')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state IN ('decided', 'accepted', 'declined')) = (decision IS NOT NULL)),
    CHECK ((state = 'draft') = (receipt IS NULL) OR state = 'withdrawn')
);

CREATE UNIQUE INDEX application_one_per_round ON unoa.application(round_id, applicant_id) WHERE state <> 'withdrawn';
CREATE INDEX application_applicant ON unoa.application(applicant_id);
CREATE INDEX application_round_state ON unoa.application(round_id, state);

CREATE FUNCTION unoa.validate_application() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    campaign unoa.admission_round%ROWTYPE;
BEGIN
    SELECT * INTO STRICT campaign FROM unoa.admission_round WHERE id = NEW.round_id;
    IF TG_OP = 'INSERT' THEN
        IF NEW.state <> 'draft' OR campaign.state <> 'open' OR statement_timestamp() NOT BETWEEN campaign.opens_at AND campaign.closes_at THEN
            RAISE EXCEPTION 'Applications are created in an open campaign' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF ROW(NEW.id, NEW.round_id, NEW.applicant_id, NEW.created_at) IS DISTINCT FROM ROW(OLD.id, OLD.round_id, OLD.applicant_id, OLD.created_at)
        OR (OLD.receipt IS NOT NULL AND NEW.receipt IS DISTINCT FROM OLD.receipt) THEN
        RAISE EXCEPTION 'The identity of an application is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.answers IS DISTINCT FROM OLD.answers AND OLD.state NOT IN ('draft', 'incomplete') THEN
        RAISE EXCEPTION 'Only a draft or an application awaiting a complement is edited' USING ERRCODE = '23514';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
        (OLD.state IN ('draft', 'incomplete') AND NEW.state = 'submitted')
        OR (OLD.state IN ('submitted', 'review') AND NEW.state IN ('incomplete', 'review', 'decided'))
        OR (OLD.state = 'decided' AND NEW.state IN ('accepted', 'declined', 'review', 'decided'))
        OR (OLD.state IN ('draft', 'submitted', 'incomplete', 'review') AND NEW.state = 'withdrawn')
    ) THEN
        RAISE EXCEPTION 'Application transition refused' USING ERRCODE = '23514';
    END IF;
    -- A complement requested by the services may be answered after closure.
    IF NEW.state = 'submitted' AND OLD.state = 'draft'
        AND (campaign.state <> 'open' OR statement_timestamp() NOT BETWEEN campaign.opens_at AND campaign.closes_at) THEN
        RAISE EXCEPTION 'The campaign is closed' USING ERRCODE = '23514';
    END IF;
    IF NEW.state = 'accepted' AND NEW.decision NOT IN ('admitted', 'conditional') THEN
        RAISE EXCEPTION 'Only an admission is accepted' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := statement_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_application BEFORE INSERT OR UPDATE ON unoa.application
FOR EACH ROW EXECUTE FUNCTION unoa.validate_application();
CREATE TRIGGER application_kept BEFORE DELETE OR TRUNCATE ON unoa.application
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.application_revision (
    application_id uuid NOT NULL REFERENCES unoa.application(id),
    revision integer NOT NULL CHECK (revision > 0),
    answers jsonb NOT NULL,
    documents jsonb NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (application_id, revision)
);

CREATE TABLE unoa.application_document (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES unoa.application(id),
    document_key text NOT NULL CHECK (document_key ~ '^[a-z][a-z0-9_]{0,40}$'),
    filename text NOT NULL CHECK (length(btrim(filename)) BETWEEN 1 AND 200),
    format text NOT NULL CHECK (format ~ '^[a-z0-9]{2,8}$'),
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    content bytea NOT NULL,
    state text NOT NULL DEFAULT 'deposited' CHECK (state IN ('deposited', 'verified', 'rejected', 'replaced')),
    note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
    checked_by uuid REFERENCES unoa.account(id),
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    CHECK (octet_length(content) = size_bytes)
);

CREATE INDEX application_document_application ON unoa.application_document(application_id, document_key);

CREATE FUNCTION unoa.validate_application_document() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND ROW(NEW.id, NEW.application_id, NEW.document_key, NEW.filename, NEW.format, NEW.size_bytes, NEW.sha256, NEW.content, NEW.uploaded_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.application_id, OLD.document_key, OLD.filename, OLD.format, OLD.size_bytes, OLD.sha256, OLD.content, OLD.uploaded_at) THEN
        RAISE EXCEPTION 'A deposited document is never rewritten' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM unoa.application WHERE id = NEW.application_id AND state IN ('draft', 'incomplete')) THEN
        RAISE EXCEPTION 'Documents are added to a draft or on request' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_application_document BEFORE INSERT OR UPDATE ON unoa.application_document
FOR EACH ROW EXECUTE FUNCTION unoa.validate_application_document();
CREATE TRIGGER application_document_kept BEFORE DELETE OR TRUNCATE ON unoa.application_document
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.application_request (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES unoa.application(id),
    message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 2000),
    requested_by uuid NOT NULL REFERENCES unoa.account(id),
    requested_at timestamptz NOT NULL DEFAULT now(),
    answered_at timestamptz
);

CREATE TABLE unoa.application_review (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES unoa.application(id),
    kind text NOT NULL CHECK (kind IN ('administrative', 'academic')),
    reviewer_id uuid NOT NULL REFERENCES unoa.account(id),
    scores jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(scores) = 'object'),
    score numeric(6, 2) CHECK (score IS NULL OR score BETWEEN 0 AND 100),
    recommendation text NOT NULL CHECK (recommendation IN ('favourable', 'reserved', 'unfavourable')),
    note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (application_id, kind, reviewer_id)
);

CREATE TABLE unoa.application_interview (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES unoa.application(id),
    kind text NOT NULL CHECK (length(btrim(kind)) BETWEEN 1 AND 120),
    scheduled_at timestamptz NOT NULL,
    place text NOT NULL CHECK (length(btrim(place)) BETWEEN 1 AND 500),
    outcome text CHECK (outcome IS NULL OR length(btrim(outcome)) BETWEEN 1 AND 2000),
    scheduled_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unoa.application_decision (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES unoa.application(id),
    decision text NOT NULL CHECK (decision IN ('admitted', 'conditional', 'waitlisted', 'refused')),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    conditions text CHECK (conditions IS NULL OR length(btrim(conditions)) BETWEEN 1 AND 2000),
    decided_by uuid NOT NULL REFERENCES unoa.account(id),
    decided_at timestamptz NOT NULL DEFAULT now(),
    supersedes uuid REFERENCES unoa.application_decision(id),
    CHECK ((decision = 'conditional') = (conditions IS NOT NULL))
);

CREATE TRIGGER application_decision_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.application_decision
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.application_appeal (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES unoa.application(id),
    decision_id uuid NOT NULL REFERENCES unoa.application_decision(id),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 4000),
    state text NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted', 'upheld', 'granted')),
    filed_at timestamptz NOT NULL DEFAULT now(),
    ruled_by uuid REFERENCES unoa.account(id),
    ruled_at timestamptz,
    ruling text CHECK (ruling IS NULL OR length(btrim(ruling)) BETWEEN 1 AND 2000),
    CHECK ((state = 'submitted') = (ruled_by IS NULL))
);

CREATE UNIQUE INDEX application_appeal_pending ON unoa.application_appeal(application_id) WHERE state = 'submitted';

CREATE FUNCTION unoa.validate_application_appeal() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.state <> 'submitted' OR ROW(NEW.id, NEW.application_id, NEW.decision_id, NEW.reason, NEW.filed_at)
            IS DISTINCT FROM ROW(OLD.id, OLD.application_id, OLD.decision_id, OLD.reason, OLD.filed_at) THEN
            RAISE EXCEPTION 'A ruled appeal is immutable' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM unoa.application_decision WHERE id = NEW.decision_id AND decided_by = NEW.ruled_by) THEN
            RAISE EXCEPTION 'An appeal is ruled by someone other than the decision author' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_application_appeal BEFORE INSERT OR UPDATE ON unoa.application_appeal
FOR EACH ROW EXECUTE FUNCTION unoa.validate_application_appeal();

-- Public view of open campaigns of a site, for the "Apply" button.
CREATE FUNCTION unoa.public_rounds(target_site uuid, target_program uuid)
RETURNS TABLE (round_id uuid, label text, opens_at timestamptz, closes_at timestamptz, instructions text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT campaign.id, campaign.label, campaign.opens_at, campaign.closes_at, campaign.instructions
    FROM unoa.admission_round AS campaign
    JOIN unoa.program_version AS version ON version.id = campaign.version_id AND version.state = 'published' AND version.admission_open
    JOIN unoa.program ON program.id = version.program_id
    WHERE program.id = target_program AND campaign.state = 'open'
      AND statement_timestamp() BETWEEN campaign.opens_at AND campaign.closes_at
      AND unoa.program_admission_allowed(program.id)
      AND unoa.scope_within(program.institution_id, unoa.site_scope(target_site))
    ORDER BY campaign.closes_at;
$$;

REVOKE EXECUTE ON FUNCTION unoa.public_rounds(uuid, uuid) FROM PUBLIC;
