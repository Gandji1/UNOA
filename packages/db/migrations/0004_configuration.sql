CREATE TABLE unoa.config_definition (
    key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND length(key) <= 96),
    label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
    description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 500),
    kind text NOT NULL CHECK (kind IN ('text', 'boolean', 'number', 'choice')),
    default_value jsonb,
    minimum numeric,
    maximum numeric,
    choices text[] NOT NULL DEFAULT '{}',
    allowed_types text[] NOT NULL CHECK (cardinality(allowed_types) > 0),
    inherits boolean NOT NULL,
    allow_override boolean NOT NULL,
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (minimum IS NULL OR maximum IS NULL OR minimum <= maximum),
    CHECK (kind = 'number' OR (minimum IS NULL AND maximum IS NULL)),
    CHECK ((kind = 'choice') = (cardinality(choices) > 0))
);

CREATE TABLE unoa.config_value (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version integer GENERATED ALWAYS AS IDENTITY UNIQUE,
    request_id uuid NOT NULL UNIQUE,
    definition_key text NOT NULL REFERENCES unoa.config_definition(key),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    value jsonb NOT NULL,
    reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
    effective_from timestamptz NOT NULL,
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'review', 'approved', 'published')),
    approved_by uuid REFERENCES unoa.account(id),
    reviewed_against integer,
    published_by uuid REFERENCES unoa.account(id),
    published_at timestamptz,
    CHECK ((state IN ('approved', 'published')) = (approved_by IS NOT NULL)),
    CHECK (approved_by IS NULL OR approved_by <> author_id),
    CHECK ((state = 'published') = (published_by IS NOT NULL)),
    CHECK ((state = 'published') = (published_at IS NOT NULL))
);

CREATE UNIQUE INDEX config_value_publication_date
ON unoa.config_value(definition_key, scope_id, effective_from) WHERE state = 'published';

CREATE INDEX config_value_scope_version ON unoa.config_value(scope_id, definition_key, version);

CREATE FUNCTION unoa.validate_config_value() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    definition unoa.config_definition%ROWTYPE;
    scope_row unoa.scope%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.id, NEW.version, NEW.request_id, NEW.definition_key, NEW.scope_id,
               NEW.value, NEW.reason, NEW.effective_from, NEW.author_id, NEW.created_at)
            IS DISTINCT FROM ROW(OLD.id, OLD.version, OLD.request_id, OLD.definition_key, OLD.scope_id,
                                 OLD.value, OLD.reason, OLD.effective_from, OLD.author_id, OLD.created_at) THEN
            RAISE EXCEPTION 'Version content is immutable' USING ERRCODE = '55000';
        END IF;
        IF NEW.state = 'published' AND NEW.effective_from <= statement_timestamp() THEN
            RAISE EXCEPTION 'Publication requires a future effective date' USING ERRCODE = '23514';
        END IF;
        IF OLD.state = 'published' THEN
            RAISE EXCEPTION 'Published values are immutable' USING ERRCODE = '55000';
        END IF;
        IF NOT (
            (OLD.state = 'draft' AND NEW.state = 'review') OR
            (OLD.state = 'review' AND NEW.state = 'approved') OR
            (OLD.state = 'approved' AND NEW.state IN ('review', 'published'))
        ) THEN
            RAISE EXCEPTION 'Invalid configuration transition' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.state <> 'draft' THEN
        RAISE EXCEPTION 'New values start in draft' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO STRICT definition FROM unoa.config_definition WHERE key = NEW.definition_key;
    SELECT * INTO STRICT scope_row FROM unoa.scope WHERE id = NEW.scope_id;
    IF NOT (scope_row.type_code = ANY (definition.allowed_types)) OR
       (scope_row.parent_id IS NOT NULL AND NOT definition.allow_override) THEN
        RAISE EXCEPTION 'Scope does not allow this parameter' USING ERRCODE = '23514';
    END IF;
    IF NOT unoa.config_value_is_valid(definition, NEW.value) THEN
        RAISE EXCEPTION 'Invalid configuration value' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION unoa.config_value_is_valid(definition unoa.config_definition, candidate jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT CASE
        WHEN definition.kind = 'text' AND jsonb_typeof(candidate) = 'string'
            THEN length(trim(candidate #>> '{}')) BETWEEN 1 AND 1000
        WHEN definition.kind = 'boolean' AND jsonb_typeof(candidate) = 'boolean' THEN true
        WHEN definition.kind = 'number' AND jsonb_typeof(candidate) = 'number'
            THEN (definition.minimum IS NULL OR (candidate #>> '{}')::numeric >= definition.minimum)
             AND (definition.maximum IS NULL OR (candidate #>> '{}')::numeric <= definition.maximum)
        WHEN definition.kind = 'choice' AND jsonb_typeof(candidate) = 'string'
            THEN (candidate #>> '{}') = ANY (definition.choices)
        ELSE false
    END
$$;

ALTER TABLE unoa.config_definition ADD CONSTRAINT config_definition_default_valid
CHECK (default_value IS NULL OR unoa.config_value_is_valid(config_definition, default_value));

CREATE TRIGGER config_value_validation
BEFORE INSERT OR UPDATE ON unoa.config_value
FOR EACH ROW EXECUTE FUNCTION unoa.validate_config_value();

CREATE TABLE unoa.config_publication_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type text NOT NULL DEFAULT 'region.configuration_published'
        CHECK (event_type = 'region.configuration_published'),
    event_version integer NOT NULL DEFAULT 1 CHECK (event_version = 1),
    version_id uuid NOT NULL UNIQUE REFERENCES unoa.config_value(id),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    actor_id uuid NOT NULL REFERENCES unoa.account(id),
    correlation_id uuid NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now()
);
