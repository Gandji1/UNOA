-- Institutional organisation: academic components are scopes of the new
-- academic_unit nature, so permissions, configuration inheritance and presence
-- windows apply to them without a parallel hierarchy. Unit types (faculty,
-- school, department, laboratory...) remain data declared by the administration.
ALTER TABLE unoa.scope_type DROP CONSTRAINT scope_type_nature_check;
ALTER TABLE unoa.scope_type ADD CONSTRAINT scope_type_nature_check
    CHECK (nature IN ('platform', 'territory', 'jurisdiction', 'institution', 'centre', 'academic_unit'));

-- Nearest establishment (legal entity) above a scope, the scope itself included.
CREATE FUNCTION unoa.nearest_institution(target uuid) RETURNS uuid
LANGUAGE sql STABLE
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    WITH RECURSIVE ancestry AS (
        SELECT scope.id, scope.parent_id, 0 AS depth FROM unoa.scope WHERE scope.id = target
        UNION ALL
        SELECT parent.id, parent.parent_id, ancestry.depth + 1
        FROM unoa.scope AS parent JOIN ancestry ON parent.id = ancestry.parent_id
    )
    SELECT ancestry.id
    FROM ancestry
    JOIN unoa.scope AS scope ON scope.id = ancestry.id
    JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature = 'institution'
    ORDER BY ancestry.depth
    LIMIT 1;
$$;

CREATE TABLE unoa.org_unit (
    scope_id uuid PRIMARY KEY REFERENCES unoa.scope(id),
    institution_id uuid NOT NULL REFERENCES unoa.scope(id),
    code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
    status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'rejected', 'closed')),
    public boolean NOT NULL DEFAULT false,
    mission text CHECK (mission IS NULL OR length(btrim(mission)) BETWEEN 1 AND 2000),
    proposed_by uuid NOT NULL REFERENCES unoa.account(id),
    decided_by uuid REFERENCES unoa.account(id),
    decided_at timestamptz,
    closed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    row_version integer NOT NULL DEFAULT 1,
    CHECK (decided_by IS NULL OR decided_by <> proposed_by),
    CHECK ((status = 'proposed') = (decided_by IS NULL))
);

-- A code identifies one living unit inside its establishment; closed units keep theirs.
CREATE UNIQUE INDEX org_unit_code ON unoa.org_unit(institution_id, code) WHERE status IN ('proposed', 'active');
CREATE INDEX org_unit_institution ON unoa.org_unit(institution_id, status);

CREATE FUNCTION unoa.validate_org_unit() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    unit_nature text;
    parent_id uuid;
    parent_status text;
BEGIN
    SELECT kind.nature, scope.parent_id INTO STRICT unit_nature, parent_id
    FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE scope.id = NEW.scope_id;
    IF unit_nature <> 'academic_unit' THEN
        RAISE EXCEPTION 'Only an academic unit scope carries an organisation profile' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.institution_id := unoa.nearest_institution(NEW.scope_id);
        IF NEW.institution_id IS NULL THEN
            RAISE EXCEPTION 'An academic unit belongs to an establishment' USING ERRCODE = '23514';
        END IF;
        IF NEW.status NOT IN ('proposed', 'active') THEN
            RAISE EXCEPTION 'A unit starts proposed or approved' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF ROW(NEW.scope_id, NEW.institution_id, NEW.code, NEW.proposed_by, NEW.created_at)
        IS DISTINCT FROM ROW(OLD.scope_id, OLD.institution_id, OLD.code, OLD.proposed_by, OLD.created_at) THEN
        RAISE EXCEPTION 'The identity of a unit is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
        (OLD.status = 'proposed' AND NEW.status IN ('active', 'rejected'))
        OR (OLD.status = 'active' AND NEW.status = 'closed')
    ) THEN
        RAISE EXCEPTION 'Transition of unit status refused' USING ERRCODE = '23514';
    END IF;
    IF OLD.status IN ('rejected', 'closed') AND ROW(NEW.public, NEW.mission) IS DISTINCT FROM ROW(OLD.public, OLD.mission) THEN
        RAISE EXCEPTION 'A closed unit is archived' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'active' AND OLD.status = 'proposed' THEN
        SELECT unit.status INTO parent_status FROM unoa.org_unit AS unit WHERE unit.scope_id = parent_id;
        IF parent_status IS NOT NULL AND parent_status <> 'active' THEN
            RAISE EXCEPTION 'The parent unit must be active' USING ERRCODE = '23514';
        END IF;
    END IF;
    NEW.row_version := OLD.row_version + 1;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_org_unit
BEFORE INSERT OR UPDATE ON unoa.org_unit
FOR EACH ROW EXECUTE FUNCTION unoa.validate_org_unit();

-- Positions and dated appointments (titular, deputy, interim).
CREATE TABLE unoa.org_position (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id uuid NOT NULL REFERENCES unoa.org_unit(scope_id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
    is_head boolean NOT NULL DEFAULT false,
    seats integer NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 500),
    public boolean NOT NULL DEFAULT false,
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (unit_id, title)
);

CREATE UNIQUE INDEX org_position_single_head ON unoa.org_position(unit_id) WHERE is_head;

CREATE TABLE unoa.org_appointment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id uuid NOT NULL REFERENCES unoa.org_position(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    capacity text NOT NULL CHECK (capacity IN ('titular', 'deputy', 'interim')),
    public_name text CHECK (public_name IS NULL OR length(btrim(public_name)) BETWEEN 1 AND 160),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    effective_from timestamptz NOT NULL,
    effective_until timestamptz,
    appointed_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE INDEX org_appointment_position ON unoa.org_appointment(position_id, effective_from);
CREATE INDEX org_appointment_account ON unoa.org_appointment(account_id);

CREATE FUNCTION unoa.validate_org_appointment() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    unit_status text;
    unit_until timestamptz;
    allowed integer;
    period tstzrange;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.id, NEW.position_id, NEW.account_id, NEW.capacity, NEW.public_name, NEW.reason,
               NEW.effective_from, NEW.appointed_by, NEW.created_at)
            IS DISTINCT FROM ROW(OLD.id, OLD.position_id, OLD.account_id, OLD.capacity, OLD.public_name, OLD.reason,
               OLD.effective_from, OLD.appointed_by, OLD.created_at) THEN
            RAISE EXCEPTION 'An appointment is only ended, never rewritten' USING ERRCODE = '23514';
        END IF;
        IF NEW.effective_until IS NULL OR (OLD.effective_until IS NOT NULL AND NEW.effective_until > OLD.effective_until) THEN
            RAISE EXCEPTION 'An appointment can only be shortened' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    -- Serialize concurrent appointments to the same position.
    PERFORM pg_advisory_xact_lock(hashtextextended('unoa.org.position.' || NEW.position_id::text, 0));
    IF NEW.effective_from < statement_timestamp() - interval '5 minutes' THEN
        RAISE EXCEPTION 'Retroactive appointments are refused' USING ERRCODE = '23514';
    END IF;
    SELECT unit.status, scope.present_until, position.seats INTO STRICT unit_status, unit_until, allowed
    FROM unoa.org_position AS position
    JOIN unoa.org_unit AS unit ON unit.scope_id = position.unit_id
    JOIN unoa.scope AS scope ON scope.id = unit.scope_id
    WHERE position.id = NEW.position_id;
    IF unit_status <> 'active' THEN
        RAISE EXCEPTION 'Appointments require an active unit' USING ERRCODE = '23514';
    END IF;
    IF unit_until IS NOT NULL AND (NEW.effective_until IS NULL OR NEW.effective_until > unit_until) THEN
        RAISE EXCEPTION 'The appointment outlasts the unit' USING ERRCODE = '23514';
    END IF;
    period := tstzrange(NEW.effective_from, coalesce(NEW.effective_until, 'infinity'::timestamptz));
    IF EXISTS (
        SELECT 1 FROM unoa.org_appointment AS other
        WHERE other.position_id = NEW.position_id AND other.account_id = NEW.account_id
          AND tstzrange(other.effective_from, coalesce(other.effective_until, 'infinity'::timestamptz)) && period
    ) THEN
        RAISE EXCEPTION 'This person already holds this position for the period' USING ERRCODE = '23505';
    END IF;
    IF NEW.capacity = 'titular' AND (
        SELECT count(*) FROM unoa.org_appointment AS other
        WHERE other.position_id = NEW.position_id AND other.capacity = 'titular'
          AND tstzrange(other.effective_from, coalesce(other.effective_until, 'infinity'::timestamptz)) && period
    ) >= allowed THEN
        RAISE EXCEPTION 'All seats of this position are filled for the period' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_org_appointment
BEFORE INSERT OR UPDATE ON unoa.org_appointment
FOR EACH ROW EXECUTE FUNCTION unoa.validate_org_appointment();

-- Dated capacities, quotas and resources per unit.
CREATE TABLE unoa.org_capacity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id uuid NOT NULL REFERENCES unoa.org_unit(scope_id),
    resource text NOT NULL CHECK (length(btrim(resource)) BETWEEN 1 AND 120),
    quantity numeric(14, 2) NOT NULL CHECK (quantity >= 0),
    measure text NOT NULL CHECK (length(btrim(measure)) BETWEEN 1 AND 60),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    effective_from timestamptz NOT NULL,
    recorded_by uuid NOT NULL REFERENCES unoa.account(id),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (unit_id, resource, effective_from)
);

-- Closure, merger and transfer are requested, then decided by another account.
CREATE TABLE unoa.org_change (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id uuid NOT NULL REFERENCES unoa.org_unit(scope_id),
    kind text NOT NULL CHECK (kind IN ('closure', 'merger', 'transfer')),
    target_id uuid REFERENCES unoa.scope(id),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    effective_at timestamptz NOT NULL,
    state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'approved', 'rejected')),
    requested_by uuid NOT NULL REFERENCES unoa.account(id),
    requested_at timestamptz NOT NULL DEFAULT now(),
    decided_by uuid REFERENCES unoa.account(id),
    decided_at timestamptz,
    decision_note text CHECK (decision_note IS NULL OR length(btrim(decision_note)) BETWEEN 1 AND 1000),
    successor_id uuid REFERENCES unoa.scope(id),
    CHECK ((kind = 'closure') = (target_id IS NULL)),
    CHECK (target_id IS NULL OR target_id <> unit_id),
    CHECK (decided_by IS NULL OR decided_by <> requested_by),
    CHECK ((state = 'requested') = (decided_by IS NULL))
);

CREATE UNIQUE INDEX org_change_pending ON unoa.org_change(unit_id) WHERE state = 'requested';

CREATE FUNCTION unoa.validate_org_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.state <> 'requested' OR NEW.effective_at < statement_timestamp() - interval '5 minutes' THEN
            RAISE EXCEPTION 'A reorganisation is requested for a future date' USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM unoa.org_unit WHERE scope_id = NEW.unit_id AND status = 'active') THEN
            RAISE EXCEPTION 'Only an active unit is reorganised' USING ERRCODE = '23514';
        END IF;
        IF NEW.kind = 'merger' AND NOT EXISTS (
            SELECT 1 FROM unoa.org_unit AS target JOIN unoa.org_unit AS unit ON unit.scope_id = NEW.unit_id
            WHERE target.scope_id = NEW.target_id AND target.status = 'active'
              AND target.institution_id = unit.institution_id
        ) THEN
            RAISE EXCEPTION 'A merger targets an active unit of the same establishment' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF ROW(NEW.id, NEW.unit_id, NEW.kind, NEW.target_id, NEW.reason, NEW.effective_at, NEW.requested_by, NEW.requested_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.unit_id, OLD.kind, OLD.target_id, OLD.reason, OLD.effective_at, OLD.requested_by, OLD.requested_at)
        OR OLD.state <> 'requested' THEN
        RAISE EXCEPTION 'A decided reorganisation is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_org_change
BEFORE INSERT OR UPDATE ON unoa.org_change
FOR EACH ROW EXECUTE FUNCTION unoa.validate_org_change();

-- Lineage keeps every link of a closed, merged or transferred unit.
CREATE TABLE unoa.org_succession (
    predecessor_id uuid NOT NULL REFERENCES unoa.org_unit(scope_id),
    successor_id uuid NOT NULL REFERENCES unoa.org_unit(scope_id),
    change_id uuid NOT NULL REFERENCES unoa.org_change(id),
    kind text NOT NULL CHECK (kind IN ('merger', 'transfer')),
    PRIMARY KEY (predecessor_id, successor_id),
    CHECK (predecessor_id <> successor_id)
);

CREATE FUNCTION unoa.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Historical records are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER org_succession_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.org_succession
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TRIGGER org_capacity_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.org_capacity
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Public organisation chart: only active, published units and the holders whose
-- name the institution chose to publish.
CREATE FUNCTION unoa.public_org_units()
RETURNS TABLE (id uuid, parent_id uuid, institution_id uuid, institution_label text,
               label text, type_label text, code text, mission text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT scope.id, scope.parent_id, unit.institution_id, institution.label,
           scope.label, kind.label, unit.code, unit.mission
    FROM unoa.org_unit AS unit
    JOIN unoa.scope AS scope ON scope.id = unit.scope_id
    JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    JOIN unoa.scope AS institution ON institution.id = unit.institution_id
    WHERE unit.status = 'active' AND unit.public
      AND scope.present_from <= statement_timestamp()
      AND (scope.present_until IS NULL OR scope.present_until > statement_timestamp())
    ORDER BY institution.label, scope.label
    LIMIT 2000;
$$;

CREATE FUNCTION unoa.public_org_positions()
RETURNS TABLE (unit_id uuid, title text, is_head boolean, holder text, capacity text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT position.unit_id, position.title, position.is_head, appointment.public_name, appointment.capacity
    FROM unoa.org_position AS position
    JOIN unoa.org_unit AS unit ON unit.scope_id = position.unit_id
    JOIN unoa.org_appointment AS appointment ON appointment.position_id = position.id
    WHERE position.public AND unit.public AND unit.status = 'active'
      AND appointment.public_name IS NOT NULL
      AND appointment.effective_from <= statement_timestamp()
      AND (appointment.effective_until IS NULL OR appointment.effective_until > statement_timestamp())
    ORDER BY position.is_head DESC, position.title, appointment.capacity
    LIMIT 5000;
$$;

REVOKE EXECUTE ON FUNCTION unoa.public_org_units() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION unoa.public_org_positions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION unoa.nearest_institution(uuid) FROM PUBLIC;
