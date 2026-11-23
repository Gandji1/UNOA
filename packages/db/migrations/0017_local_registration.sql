-- Self-registration with a local identifier and password on a site whose
-- administration opened account creation (candidates, learners): an account
-- without any role (ADR-0010).
CREATE FUNCTION unoa.register_local_account(target_site uuid, new_login text, new_hash text, full_name text, contact text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    holder uuid;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM unoa.site WHERE id = target_site AND online AND open_registration) THEN
        RAISE EXCEPTION 'Account creation is closed on this site' USING ERRCODE = 'U0403';
    END IF;
    IF EXISTS (SELECT 1 FROM unoa.local_credential WHERE login = new_login)
        OR EXISTS (SELECT 1 FROM unoa.login_identity WHERE issuer = 'local' AND subject = new_login) THEN
        RAISE EXCEPTION 'This identifier is taken' USING ERRCODE = 'U0409';
    END IF;
    INSERT INTO unoa.account(display_name, email, origin) VALUES (full_name, contact, 'registration') RETURNING id INTO holder;
    INSERT INTO unoa.login_identity(issuer, subject, account_id) VALUES ('local', new_login, holder);
    INSERT INTO unoa.local_credential(account_id, login, password_hash, must_change) VALUES (holder, new_login, new_hash, false);
    INSERT INTO unoa.audit_event(actor_id, scope_id, action, correlation_id, resource_id, outcome)
    SELECT holder, scope_id, 'iam.account_registered', gen_random_uuid(), holder, 'allowed' FROM unoa.site WHERE id = target_site;
    RETURN holder;
END;
$$;
REVOKE EXECUTE ON FUNCTION unoa.register_local_account(uuid, text, text, text, text) FROM PUBLIC;
