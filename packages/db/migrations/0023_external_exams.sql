-- External national examinations (module EXN): documentary follow-up only.
-- The platform publishes information about an examination organised by an
-- official authority, records a student's voluntary declaration, receives the
-- official copy of a result or diploma and records its verification. It never
-- produces a national result or a State diploma: no table here holds a mark,
-- and an unverified or missing document is never read as a success.

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('exn.read', 'EXN', 'Consulter le suivi des examens nationaux', true),
    ('exn.manage', 'EXN', 'Publier les informations sur les examens nationaux', false),
    ('exn.verify', 'EXN', 'Vérifier les pièces officielles déposées', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;

INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES
    ('institution_admin', 'exn.read'), ('institution_admin', 'exn.manage'), ('institution_admin', 'exn.verify'),
    ('country_admin', 'exn.read'), ('country_admin', 'exn.manage'),
    ('registrar', 'exn.read'), ('registrar', 'exn.manage'), ('registrar_validator', 'exn.read'), ('registrar_validator', 'exn.verify'),
    ('admissions_officer', 'exn.read'), ('auditor', 'exn.read')
) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.access_role WHERE code = item.role)
ON CONFLICT DO NOTHING;

INSERT INTO unoa.notification_event(code, module, variables, sensitive) VALUES
    ('exn.verified', 'EXN', '{exam,state}', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE unoa.external_exam (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    authority text NOT NULL CHECK (length(btrim(authority)) BETWEEN 1 AND 200),
    official_url text CHECK (official_url IS NULL OR (official_url ~ '^https://[^\s]+$' AND length(official_url) <= 2000)),
    session_label text NOT NULL CHECK (length(btrim(session_label)) BETWEEN 1 AND 120),
    description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 6000),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'archived')),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    CHECK ((state = 'draft') = (published_at IS NULL))
);

CREATE TABLE unoa.external_participation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id uuid NOT NULL REFERENCES unoa.external_exam(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    candidate_number text CHECK (candidate_number IS NULL OR length(btrim(candidate_number)) BETWEEN 1 AND 60),
    statement text CHECK (statement IS NULL OR length(btrim(statement)) BETWEEN 1 AND 2000),
    declared_at timestamptz NOT NULL DEFAULT now(),
    withdrawn_at timestamptz,
    UNIQUE (exam_id, account_id)
);

-- A copy of an official document: the platform records what the authority
-- issued (reference, authority, the outcome printed on it) and its own checks.
CREATE TABLE unoa.external_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    participation_id uuid NOT NULL REFERENCES unoa.external_participation(id),
    kind text NOT NULL CHECK (kind IN ('result', 'diploma')),
    issuing_authority text NOT NULL CHECK (length(btrim(issuing_authority)) BETWEEN 1 AND 200),
    document_reference text CHECK (document_reference IS NULL OR length(btrim(document_reference)) BETWEEN 1 AND 120),
    stated_outcome text CHECK (stated_outcome IS NULL OR length(btrim(stated_outcome)) BETWEEN 1 AND 200),
    filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
    format text NOT NULL CHECK (format IN ('pdf', 'png', 'jpg')),
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    content bytea NOT NULL,
    state text NOT NULL DEFAULT 'deposited' CHECK (state IN ('deposited', 'in_review', 'verified', 'rejected')),
    deposited_by uuid NOT NULL REFERENCES unoa.account(id),
    deposited_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX external_evidence_participation ON unoa.external_evidence(participation_id);
CREATE FUNCTION unoa.validate_external_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' OR ROW(NEW.participation_id, NEW.kind, NEW.issuing_authority, NEW.document_reference, NEW.stated_outcome, NEW.filename,
        NEW.format, NEW.size_bytes, NEW.sha256, NEW.content, NEW.deposited_by, NEW.deposited_at)
        IS DISTINCT FROM ROW(OLD.participation_id, OLD.kind, OLD.issuing_authority, OLD.document_reference, OLD.stated_outcome, OLD.filename,
        OLD.format, OLD.size_bytes, OLD.sha256, OLD.content, OLD.deposited_by, OLD.deposited_at) THEN
        RAISE EXCEPTION 'A deposited document is kept as deposited' USING ERRCODE = '23514';
    END IF;
    IF NOT ((OLD.state = 'deposited' AND NEW.state IN ('in_review', 'verified', 'rejected')) OR (OLD.state = 'in_review' AND NEW.state IN ('verified', 'rejected'))
        OR OLD.state = NEW.state) THEN
        RAISE EXCEPTION 'Invalid verification transition' USING ERRCODE = '23514';
    END IF;
    IF OLD.state IN ('verified', 'rejected') AND NEW.state <> OLD.state THEN
        RAISE EXCEPTION 'A verification is final; deposit a new document' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_external_evidence BEFORE UPDATE OR DELETE ON unoa.external_evidence FOR EACH ROW EXECUTE FUNCTION unoa.validate_external_evidence();

-- Proof of each check, kept with limited access (EXN-009).
CREATE TABLE unoa.external_verification (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_id uuid NOT NULL REFERENCES unoa.external_evidence(id),
    step text NOT NULL CHECK (step IN ('in_review', 'verified', 'rejected')),
    method text NOT NULL CHECK (method IN ('authority_register', 'authority_contact', 'original_seen', 'other')),
    note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
    verifier_id uuid NOT NULL REFERENCES unoa.account(id),
    proof_filename text CHECK (proof_filename IS NULL OR length(proof_filename) BETWEEN 1 AND 200),
    proof_sha256 text CHECK (proof_sha256 IS NULL OR proof_sha256 ~ '^[0-9a-f]{64}$'),
    proof_content bytea,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((proof_content IS NULL) = (proof_sha256 IS NULL))
);
CREATE TRIGGER external_verification_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.external_verification FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
CREATE FUNCTION unoa.check_external_verifier() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM unoa.external_evidence AS evidence JOIN unoa.external_participation AS participation ON participation.id = evidence.participation_id
        WHERE evidence.id = NEW.evidence_id AND (evidence.deposited_by = NEW.verifier_id OR participation.account_id = NEW.verifier_id)) THEN
        RAISE EXCEPTION 'A document is verified by another person than the depositor' USING ERRCODE = 'U0403';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER check_external_verifier BEFORE INSERT ON unoa.external_verification FOR EACH ROW EXECUTE FUNCTION unoa.check_external_verifier();

CREATE TABLE unoa.external_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    participation_id uuid NOT NULL REFERENCES unoa.external_participation(id),
    kind text NOT NULL CHECK (kind ~ '^[a-z_]{3,40}$'),
    detail text CHECK (detail IS NULL OR length(detail) <= 1000),
    actor_id uuid NOT NULL REFERENCES unoa.account(id),
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX external_event_participation ON unoa.external_event(participation_id, occurred_at);
CREATE TRIGGER external_event_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.external_event FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
