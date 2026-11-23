-- Development mode decided by the owner (23 November 2026): while the platform
-- is being built, any password length is accepted and no lockout applies. It is
-- switched by the super-administrator, shown on the sign-in page, and audited.
-- Password reset by an administrator covering the account.

ALTER TABLE unoa.installation ADD COLUMN development_mode boolean NOT NULL DEFAULT false;

CREATE FUNCTION unoa.set_development_mode(actor uuid, enabled boolean, correlation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF NOT unoa.has_scope_permission(actor, 'iam.manage', unoa.iam_root()) THEN
        RAISE EXCEPTION 'Development mode refused' USING ERRCODE = 'U0403';
    END IF;
    INSERT INTO unoa.installation(account_id, development_mode) VALUES (actor, enabled)
    ON CONFLICT (singleton) DO UPDATE SET development_mode = EXCLUDED.development_mode;
    PERFORM unoa.iam_audit(actor, unoa.iam_root(), CASE WHEN enabled THEN 'iam.development_mode_on' ELSE 'iam.development_mode_off' END, NULL, correlation);
END;
$$;

CREATE FUNCTION unoa.reset_local_password(actor uuid, target uuid, new_hash text, temporary boolean, correlation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF actor = target OR NOT unoa.covers_account(actor, 'iam.accounts', target) THEN
        RAISE EXCEPTION 'Password reset refused' USING ERRCODE = 'U0403';
    END IF;
    UPDATE unoa.local_credential SET password_hash = new_hash, must_change = temporary, failed_attempts = 0, locked_until = NULL, changed_at = now()
    WHERE account_id = target;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No local credential' USING ERRCODE = 'P0002';
    END IF;
    PERFORM unoa.iam_audit(actor, NULL, 'iam.password_reset', target, correlation);
END;
$$;

REVOKE EXECUTE ON FUNCTION unoa.set_development_mode(uuid, boolean, uuid), unoa.reset_local_password(uuid, uuid, text, boolean, uuid) FROM PUBLIC;
