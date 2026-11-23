-- Local sign-in (ADR-0010): identifier + password (scrypt) + time-based code
-- for accounts holding a role, while no institutional OIDC provider is set.
-- One-time installation of the first platform administrator.

CREATE TABLE unoa.local_credential (
    account_id uuid PRIMARY KEY REFERENCES unoa.account(id),
    login text NOT NULL UNIQUE CHECK (login ~ '^[a-z0-9][a-z0-9._@-]{2,119}$'),
    password_hash text NOT NULL CHECK (password_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$'),
    totp_secret text CHECK (totp_secret IS NULL OR totp_secret ~ '^[A-Z2-7]{16,64}$'),
    failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until timestamptz,
    must_change boolean NOT NULL DEFAULT true,
    changed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unoa.installation (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    completed_at timestamptz NOT NULL DEFAULT now()
);

-- Installation: refused once a platform administrator exists; runs the
-- bootstrap as the schema owner and records the local credential.
CREATE FUNCTION unoa.install_platform(admin_login text, admin_hash text, admin_secret text, admin_name text,
    platform_type text, platform_label text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    holder uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM unoa.installation) OR EXISTS (SELECT 1 FROM unoa.role_grant WHERE role_code = 'platform_admin' AND revoked_at IS NULL) THEN
        RAISE EXCEPTION 'The platform is already installed' USING ERRCODE = 'U0409';
    END IF;
    holder := unoa.bootstrap_platform('local', admin_login, admin_name, NULL, platform_type, platform_label);
    INSERT INTO unoa.local_credential(account_id, login, password_hash, totp_secret, must_change)
    VALUES (holder, admin_login, admin_hash, admin_secret, true);
    INSERT INTO unoa.installation(account_id) VALUES (holder);
    RETURN holder;
END;
$$;

REVOKE EXECUTE ON FUNCTION unoa.install_platform(text, text, text, text, text, text) FROM PUBLIC;
