CREATE SCHEMA unoa;
REVOKE ALL ON SCHEMA unoa FROM PUBLIC;

CREATE TABLE unoa.scope_type (
    code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{0,62}$'),
    label text NOT NULL CHECK (length(trim(label)) > 0)
);

CREATE TABLE unoa.scope (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type_code text NOT NULL REFERENCES unoa.scope_type(code),
    parent_id uuid REFERENCES unoa.scope(id),
    label text NOT NULL CHECK (length(trim(label)) > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX scope_platform_root ON unoa.scope ((parent_id IS NULL)) WHERE parent_id IS NULL;
CREATE INDEX scope_parent ON unoa.scope(parent_id);

CREATE FUNCTION unoa.validate_scope_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.id IS DISTINCT FROM OLD.id THEN
            RAISE EXCEPTION 'Scope ancestry and identity are immutable' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.parent_id IS NOT NULL THEN
        IF NEW.parent_id = NEW.id OR NOT EXISTS (
            SELECT 1 FROM unoa.scope WHERE id = NEW.parent_id
        ) THEN
            RAISE EXCEPTION 'A parent scope must already exist' USING ERRCODE = '23503';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_scope_parent
BEFORE INSERT OR UPDATE OF parent_id, id ON unoa.scope
FOR EACH ROW EXECUTE FUNCTION unoa.validate_scope_parent();
