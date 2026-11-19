CREATE TABLE unoa.account (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    disabled_at timestamptz
);

CREATE TABLE unoa.login_identity (
    issuer text NOT NULL CHECK (length(trim(issuer)) > 0),
    subject text NOT NULL CHECK (length(trim(subject)) > 0),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    PRIMARY KEY (issuer, subject)
);

CREATE INDEX login_identity_account ON unoa.login_identity(account_id);

CREATE TABLE unoa.access_role (
    code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{0,62}$')
);

CREATE TABLE unoa.permission (
    code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_.]{0,95}$')
);

CREATE TABLE unoa.role_permission (
    role_code text REFERENCES unoa.access_role(code),
    permission_code text REFERENCES unoa.permission(code),
    PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE unoa.role_grant (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    role_code text NOT NULL REFERENCES unoa.access_role(code),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    include_descendants boolean NOT NULL DEFAULT false,
    effective_from timestamptz NOT NULL,
    effective_until timestamptz,
    revoked_at timestamptz,
    CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE INDEX role_grant_access ON unoa.role_grant(account_id, scope_id, role_code);

-- Both the actor and the resource scope must come from trusted server state.
-- This evaluates a current authorization, with business-specific guards still applied by the caller.
CREATE FUNCTION unoa.has_scope_permission(
    actor uuid, requested_permission text, resource_scope uuid
) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, unoa
AS $$
    WITH RECURSIVE ancestry AS (
        SELECT id, parent_id
        FROM unoa.scope
        WHERE id = resource_scope
        UNION ALL
        SELECT parent.id, parent.parent_id
        FROM unoa.scope AS parent
        JOIN ancestry ON parent.id = ancestry.parent_id
    )
    SELECT EXISTS (
        SELECT 1
        FROM ancestry
        JOIN unoa.role_grant AS assignment ON assignment.scope_id = ancestry.id
        JOIN unoa.account AS account ON account.id = assignment.account_id
        JOIN unoa.role_permission AS allowed ON allowed.role_code = assignment.role_code
        WHERE assignment.account_id = actor
          AND account.disabled_at IS NULL
          AND allowed.permission_code = requested_permission
          AND assignment.effective_from <= statement_timestamp()
          AND (assignment.effective_until IS NULL OR statement_timestamp() < assignment.effective_until)
          AND assignment.revoked_at IS NULL
          AND (assignment.scope_id = resource_scope OR assignment.include_descendants)
    );
$$;

REVOKE EXECUTE ON FUNCTION unoa.has_scope_permission(uuid, text, uuid) FROM PUBLIC;

CREATE TABLE unoa.audit_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid REFERENCES unoa.account(id),
    scope_id uuid REFERENCES unoa.scope(id),
    action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.]{0,95}$'),
    correlation_id uuid NOT NULL,
    resource_id uuid,
    outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'failed')),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_event_scope_time ON unoa.audit_event(scope_id, occurred_at DESC);
CREATE INDEX audit_event_correlation ON unoa.audit_event(correlation_id);

CREATE FUNCTION unoa.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Audit events are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.audit_event
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_audit_mutation();
