ALTER TABLE unoa.account
    ADD COLUMN session_epoch bigint NOT NULL DEFAULT 0 CHECK (session_epoch >= 0);

CREATE TABLE unoa.login_session (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    account_epoch bigint NOT NULL CHECK (account_epoch >= 0),
    started_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > started_at)
);

CREATE INDEX login_session_account ON unoa.login_session(account_id, started_at DESC);
CREATE INDEX login_session_expiry ON unoa.login_session(expires_at);

-- The web role can evaluate authorization without listing the roles or territories.
ALTER FUNCTION unoa.has_scope_permission(uuid, text, uuid) SECURITY DEFINER;
ALTER FUNCTION unoa.has_scope_permission(uuid, text, uuid) SET search_path = pg_catalog, unoa, pg_temp;

CREATE FUNCTION unoa.revoke_disabled_account_sessions() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    NEW.session_epoch := OLD.session_epoch + 1;
    UPDATE unoa.login_session
    SET revoked_at = statement_timestamp()
    WHERE account_id = NEW.id AND revoked_at IS NULL;
    RETURN NEW;
END;
$$;

CREATE TRIGGER revoke_disabled_account_sessions
BEFORE UPDATE OF disabled_at ON unoa.account
FOR EACH ROW WHEN (OLD.disabled_at IS NULL AND NEW.disabled_at IS NOT NULL)
EXECUTE FUNCTION unoa.revoke_disabled_account_sessions();
