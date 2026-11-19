-- Territorial model: configurable types, configurable hierarchy rules, regional
-- attributes, translated designations, presence windows and multiple attachments.
ALTER TABLE unoa.scope_type
    ADD COLUMN nature text NOT NULL DEFAULT 'territory'
        CHECK (nature IN ('platform', 'territory', 'jurisdiction', 'institution', 'centre'));

COMMENT ON COLUMN unoa.scope_type.nature IS
    'Types created before this migration keep the territory nature and must be reviewed.';

-- The hierarchy is data, never a constant: an authorised administrator declares
-- which type may be created under which other type.
CREATE TABLE unoa.scope_type_parent (
    type_code text NOT NULL REFERENCES unoa.scope_type(code),
    parent_type_code text NOT NULL REFERENCES unoa.scope_type(code),
    PRIMARY KEY (type_code, parent_type_code)
);

CREATE INDEX scope_type_parent_parent ON unoa.scope_type_parent(parent_type_code);

ALTER TABLE unoa.scope
    ADD COLUMN time_zone text,
    ADD COLUMN currency text CHECK (currency ~ '^[A-Z]{3}$'),
    ADD COLUMN locale text CHECK (locale ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$'),
    ADD COLUMN legal_name text CHECK (legal_name IS NULL OR length(btrim(legal_name)) BETWEEN 1 AND 200),
    ADD COLUMN contact text CHECK (contact IS NULL OR length(btrim(contact)) BETWEEN 1 AND 500),
    ADD COLUMN present_from timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN present_until timestamptz,
    ADD CONSTRAINT scope_presence CHECK (present_until IS NULL OR present_until > present_from);

CREATE TABLE unoa.scope_label (
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    language text NOT NULL CHECK (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope_id, language)
);

-- An establishment may operate in several territories and answer to several
-- regulatory frameworks at once, each attachment being dated.
CREATE TABLE unoa.scope_attachment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    territory_id uuid NOT NULL REFERENCES unoa.scope(id),
    kind text NOT NULL CHECK (kind IN ('implantation', 'regulatory')),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    effective_from timestamptz NOT NULL,
    effective_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (scope_id <> territory_id),
    CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE UNIQUE INDEX scope_attachment_unique ON unoa.scope_attachment(scope_id, territory_id, kind);
CREATE INDEX scope_attachment_territory ON unoa.scope_attachment(territory_id);

CREATE FUNCTION unoa.validate_scope_territory() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    own unoa.scope_type%ROWTYPE;
    parent unoa.scope%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.type_code IS DISTINCT FROM OLD.type_code THEN
        RAISE EXCEPTION 'A scope type is immutable' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO STRICT own FROM unoa.scope_type WHERE code = NEW.type_code;
    -- The IANA database shipped with the server is the reference, never a constant list.
    IF NEW.time_zone IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.time_zone) THEN
        RAISE EXCEPTION 'Unknown IANA time zone' USING ERRCODE = '23514';
    END IF;
    IF own.nature NOT IN ('institution', 'centre')
        AND (NEW.legal_name IS NOT NULL OR NEW.contact IS NOT NULL) THEN
        RAISE EXCEPTION 'Legal identity belongs to establishments' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.present_until IS DISTINCT FROM OLD.present_until
        AND NEW.present_until IS NOT NULL AND EXISTS (
            SELECT 1 FROM unoa.scope AS child
            WHERE child.parent_id = NEW.id
              AND (child.present_until IS NULL OR child.present_until > NEW.present_until)
        ) THEN
        RAISE EXCEPTION 'Close the subordinate scopes first' USING ERRCODE = '23514';
    END IF;
    IF NEW.parent_id IS NULL THEN
        IF own.nature <> 'platform' THEN
            RAISE EXCEPTION 'Only a platform type may be the root scope' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO STRICT parent FROM unoa.scope WHERE id = NEW.parent_id;
    IF TG_OP = 'INSERT' AND NOT EXISTS (
        SELECT 1 FROM unoa.scope_type_parent
        WHERE type_code = NEW.type_code AND parent_type_code = parent.type_code
    ) THEN
        RAISE EXCEPTION 'This hierarchy is not declared' USING ERRCODE = '23514';
    END IF;
    -- Presence is only revalidated when it moves, so closing a region never
    -- freezes the records of the establishments it still holds.
    IF TG_OP = 'INSERT' OR NEW.present_from IS DISTINCT FROM OLD.present_from
        OR NEW.present_until IS DISTINCT FROM OLD.present_until THEN
        IF NEW.present_from < parent.present_from OR (parent.present_until IS NOT NULL
            AND (NEW.present_until IS NULL OR NEW.present_until > parent.present_until)) THEN
            RAISE EXCEPTION 'Presence must stay inside the parent presence' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_scope_territory
BEFORE INSERT OR UPDATE ON unoa.scope
FOR EACH ROW EXECUTE FUNCTION unoa.validate_scope_territory();

CREATE FUNCTION unoa.validate_scope_attachment() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    holder text;
    target text;
BEGIN
    IF TG_OP = 'UPDATE' AND ROW(NEW.id, NEW.scope_id, NEW.territory_id, NEW.kind, NEW.effective_from)
        IS DISTINCT FROM ROW(OLD.id, OLD.scope_id, OLD.territory_id, OLD.kind, OLD.effective_from) THEN
        RAISE EXCEPTION 'An attachment identity is immutable' USING ERRCODE = '23514';
    END IF;
    SELECT nature INTO STRICT holder
    FROM unoa.scope JOIN unoa.scope_type ON scope_type.code = scope.type_code WHERE scope.id = NEW.scope_id;
    SELECT nature INTO STRICT target
    FROM unoa.scope JOIN unoa.scope_type ON scope_type.code = scope.type_code WHERE scope.id = NEW.territory_id;
    IF holder NOT IN ('institution', 'centre') THEN
        RAISE EXCEPTION 'Only an establishment is attached' USING ERRCODE = '23514';
    END IF;
    IF (NEW.kind = 'implantation' AND target <> 'territory')
        OR (NEW.kind = 'regulatory' AND target <> 'jurisdiction') THEN
        RAISE EXCEPTION 'Attachment target does not match its kind' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_scope_attachment
BEFORE INSERT OR UPDATE ON unoa.scope_attachment
FOR EACH ROW EXECUTE FUNCTION unoa.validate_scope_attachment();
