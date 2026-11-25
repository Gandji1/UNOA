-- Documents and diplomas (module CRED): only authorised documents. A document
-- type names its issuing authority; an establishment diploma is locked unless
-- the programme holds a verified authorisation in force; no national (State)
-- title can be modelled. Documents are numbered, signed by the required number
-- of other people, sealed by a hash, verifiable by a minimal-disclosure code,
-- revoked and reissued with a trace.

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('cred.read', 'CRED', 'Consulter le registre des documents', true),
    ('cred.design', 'CRED', 'Rédiger types et modèles de documents', false),
    ('cred.approve', 'CRED', 'Approuver types et modèles de documents', true),
    ('cred.issue', 'CRED', 'Préparer la délivrance des documents', true),
    ('cred.sign', 'CRED', 'Signer les documents', true),
    ('cred.revoke', 'CRED', 'Révoquer les documents', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;

INSERT INTO unoa.access_role(code, label, description, level, ordinal) VALUES
    ('documents_officer', 'Gestionnaire des documents', 'Rédige les modèles et prépare la délivrance des attestations et diplômes.', 'institution', 131),
    ('documents_signatory', 'Signataire des documents', 'Signe les documents préparés par d’autres ; peut révoquer avec motif.', 'institution', 132)
ON CONFLICT (code) DO NOTHING;

INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES
    ('documents_officer', 'cred.read'), ('documents_officer', 'cred.design'), ('documents_officer', 'cred.issue'),
    ('documents_signatory', 'cred.read'), ('documents_signatory', 'cred.sign'), ('documents_signatory', 'cred.revoke'), ('documents_signatory', 'cred.approve'),
    ('institution_admin', 'cred.read'), ('institution_admin', 'cred.approve'), ('dean', 'cred.read'), ('dean', 'cred.sign'),
    ('registrar', 'cred.read'), ('registrar', 'cred.issue'), ('auditor', 'cred.read')
) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.access_role WHERE code = item.role)
ON CONFLICT DO NOTHING;

INSERT INTO unoa.notification_event(code, module, variables, sensitive) VALUES
    ('cred.issued', 'CRED', '{type,number}', false),
    ('cred.revoked', 'CRED', '{type,number}', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE unoa.credential_type (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,15}$'),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
    category text NOT NULL CHECK (category IN ('internal_attestation', 'institutional_diploma', 'badge')),
    issuing_authority text NOT NULL CHECK (length(btrim(issuing_authority)) BETWEEN 1 AND 200),
    program_id uuid REFERENCES unoa.program(id),
    eligibility text NOT NULL CHECK (eligibility IN ('enrolled', 'result_published', 'graduated', 'short_completion', 'stack_completion')),
    required_signatures integer NOT NULL CHECK (required_signatures BETWEEN 1 AND 3),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'retired')),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    publisher_id uuid REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (scope_id, code),
    CHECK (category <> 'institutional_diploma' OR (program_id IS NOT NULL AND eligibility = 'graduated' AND required_signatures >= 2)),
    CHECK ((state = 'draft') = (publisher_id IS NULL)),
    CHECK (publisher_id IS NULL OR publisher_id <> author_id)
);
CREATE FUNCTION unoa.validate_credential_type() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A document type is kept' USING ERRCODE = '23514'; END IF;
    IF OLD.state <> 'draft' AND (ROW(NEW.scope_id, NEW.code, NEW.label, NEW.category, NEW.issuing_authority, NEW.program_id, NEW.eligibility, NEW.required_signatures, NEW.author_id, NEW.publisher_id)
        IS DISTINCT FROM ROW(OLD.scope_id, OLD.code, OLD.label, OLD.category, OLD.issuing_authority, OLD.program_id, OLD.eligibility, OLD.required_signatures, OLD.author_id, OLD.publisher_id)
        OR (OLD.state = 'retired' AND NEW.state <> 'retired')) THEN
        RAISE EXCEPTION 'A published document type is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_credential_type BEFORE UPDATE OR DELETE ON unoa.credential_type FOR EACH ROW EXECUTE FUNCTION unoa.validate_credential_type();

CREATE TABLE unoa.document_template (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type_id uuid NOT NULL REFERENCES unoa.credential_type(id),
    language text NOT NULL CHECK (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
    version integer NOT NULL CHECK (version > 0),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 8000),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'superseded')),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    publisher_id uuid REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (type_id, language, version),
    CHECK ((state = 'draft') = (publisher_id IS NULL)),
    CHECK (publisher_id IS NULL OR publisher_id <> author_id)
);
CREATE UNIQUE INDEX document_template_current ON unoa.document_template(type_id, language) WHERE state = 'published';
CREATE FUNCTION unoa.validate_document_template() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' OR (OLD.state <> 'draft' AND ROW(NEW.type_id, NEW.language, NEW.version, NEW.title, NEW.body, NEW.author_id, NEW.publisher_id)
        IS DISTINCT FROM ROW(OLD.type_id, OLD.language, OLD.version, OLD.title, OLD.body, OLD.author_id, OLD.publisher_id))
        OR (OLD.state = 'superseded' AND NEW.state <> 'superseded') THEN
        RAISE EXCEPTION 'A published template version is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_document_template BEFORE UPDATE OR DELETE ON unoa.document_template FOR EACH ROW EXECUTE FUNCTION unoa.validate_document_template();

CREATE TABLE unoa.cred_counter (
    type_id uuid NOT NULL REFERENCES unoa.credential_type(id),
    year integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
    next_value bigint NOT NULL CHECK (next_value > 0),
    PRIMARY KEY (type_id, year)
);

CREATE TABLE unoa.credential (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type_id uuid NOT NULL REFERENCES unoa.credential_type(id),
    template_id uuid NOT NULL REFERENCES unoa.document_template(id),
    holder_id uuid NOT NULL REFERENCES unoa.account(id),
    student_id uuid REFERENCES unoa.student(id),
    source_id uuid,
    number text NOT NULL CHECK (number ~ '^[A-Z0-9-]{2,16}-[0-9]{4}-[0-9]{6}$'),
    exclusive boolean NOT NULL,
    content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
    rendered text NOT NULL,
    sha256 text NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    verification_code text NOT NULL UNIQUE CHECK (verification_code ~ '^[A-Z2-7]{26}$'),
    state text NOT NULL DEFAULT 'pending_signature' CHECK (state IN ('pending_signature', 'issued', 'revoked')),
    replaces uuid REFERENCES unoa.credential(id),
    requested_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    issued_at timestamptz,
    UNIQUE (type_id, number),
    CHECK ((state = 'pending_signature') = (issued_at IS NULL) OR state = 'revoked')
);
-- One diploma in force per student and type: a reissue follows a revocation.
CREATE UNIQUE INDEX credential_exclusive ON unoa.credential(type_id, holder_id) WHERE exclusive AND state <> 'revoked';
-- One document in force per completed source (short-course enrolment or stack).
CREATE UNIQUE INDEX credential_source ON unoa.credential(type_id, source_id) WHERE source_id IS NOT NULL AND state <> 'revoked';
CREATE FUNCTION unoa.validate_credential() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' OR ROW(NEW.type_id, NEW.template_id, NEW.holder_id, NEW.student_id, NEW.source_id, NEW.number, NEW.exclusive, NEW.content, NEW.rendered, NEW.sha256, NEW.verification_code, NEW.replaces, NEW.requested_by)
        IS DISTINCT FROM ROW(OLD.type_id, OLD.template_id, OLD.holder_id, OLD.student_id, OLD.source_id, OLD.number, OLD.exclusive, OLD.content, OLD.rendered, OLD.sha256, OLD.verification_code, OLD.replaces, OLD.requested_by) THEN
        RAISE EXCEPTION 'An issued document is never rewritten' USING ERRCODE = '23514';
    END IF;
    IF NEW.state <> OLD.state AND NOT ((OLD.state = 'pending_signature' AND NEW.state IN ('issued', 'revoked')) OR (OLD.state = 'issued' AND NEW.state = 'revoked')) THEN
        RAISE EXCEPTION 'Invalid document transition' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_credential BEFORE UPDATE OR DELETE ON unoa.credential FOR EACH ROW EXECUTE FUNCTION unoa.validate_credential();

CREATE TABLE unoa.credential_signature (
    credential_id uuid NOT NULL REFERENCES unoa.credential(id),
    signer_id uuid NOT NULL REFERENCES unoa.account(id),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    signed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (credential_id, signer_id)
);
CREATE TRIGGER credential_signature_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.credential_signature FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
CREATE FUNCTION unoa.check_credential_signer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM unoa.credential WHERE credential.id = NEW.credential_id
        AND (credential.requested_by = NEW.signer_id OR credential.holder_id = NEW.signer_id)) THEN
        RAISE EXCEPTION 'A document is signed by other people than its preparer and holder' USING ERRCODE = 'U0403';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unoa.credential WHERE id = NEW.credential_id AND sha256 = NEW.sha256 AND state = 'pending_signature') THEN
        RAISE EXCEPTION 'The signature covers the pending document fingerprint' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER check_credential_signer BEFORE INSERT ON unoa.credential_signature FOR EACH ROW EXECUTE FUNCTION unoa.check_credential_signer();

CREATE TABLE unoa.credential_revocation (
    credential_id uuid PRIMARY KEY REFERENCES unoa.credential(id),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    revoked_by uuid NOT NULL REFERENCES unoa.account(id),
    revoked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER credential_revocation_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.credential_revocation FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Public lookups are logged by code fingerprint only (no personal data).
CREATE TABLE unoa.credential_lookup (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code_sha256 text NOT NULL CHECK (code_sha256 ~ '^[0-9a-f]{64}$'),
    found boolean NOT NULL,
    looked_up_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER credential_lookup_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.credential_lookup FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Minimal disclosure for the public verifier (CRED-007/008): no matricule, no
-- full name, no content; callable by the web role without any table access.
CREATE FUNCTION unoa.verify_credential(lookup_code text) RETURNS TABLE (state text, type_label text, category text, issuing_authority text, institution text,
    number text, issued_at timestamptz, revoked_at timestamptz, holder_initials text, replaced_by_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    found_row record;
    matched boolean;
BEGIN
    IF lookup_code IS NULL OR lookup_code !~ '^[A-Z2-7]{26}$' THEN
        INSERT INTO unoa.credential_lookup(code_sha256, found) VALUES (encode(sha256(convert_to(coalesce(lookup_code, ''), 'UTF8')), 'hex'), false);
        RETURN;
    END IF;
    SELECT credential.state, kind.label, kind.category, kind.issuing_authority, scope.label AS institution, credential.number, credential.issued_at,
        revocation.revoked_at, account.display_name, (SELECT next.number FROM unoa.credential AS next WHERE next.replaces = credential.id LIMIT 1) AS replaced
    INTO found_row FROM unoa.credential JOIN unoa.credential_type AS kind ON kind.id = credential.type_id JOIN unoa.scope ON scope.id = kind.scope_id
    JOIN unoa.account ON account.id = credential.holder_id
    LEFT JOIN unoa.credential_revocation AS revocation ON revocation.credential_id = credential.id
    WHERE credential.verification_code = lookup_code AND credential.state <> 'pending_signature';
    matched := FOUND;
    INSERT INTO unoa.credential_lookup(code_sha256, found) VALUES (encode(sha256(convert_to(lookup_code, 'UTF8')), 'hex'), matched);
    IF NOT matched THEN RETURN; END IF;
    RETURN QUERY SELECT found_row.state::text, found_row.label::text, found_row.category::text, found_row.issuing_authority::text, found_row.institution::text,
        found_row.number::text, found_row.issued_at, found_row.revoked_at,
        (SELECT string_agg(left(part, 1) || '.', ' ') FROM regexp_split_to_table(coalesce(found_row.display_name, ''), '\s+') AS part WHERE part <> ''),
        found_row.replaced::text;
END;
$$;
REVOKE EXECUTE ON FUNCTION unoa.verify_credential(text) FROM PUBLIC;
