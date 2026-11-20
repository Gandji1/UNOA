-- Administration of identities and access (IAM): accounts with a profile,
-- a permission catalogue owned by the code, roles composed by the
-- administration, justified grants and delegations, invitations, open
-- registration per site and the bootstrap of the first platform administrator.

ALTER TABLE unoa.account
    ADD COLUMN display_name text CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 200),
    ADD COLUMN email text CHECK (email IS NULL OR (length(email) <= 254 AND email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
    ADD COLUMN origin text NOT NULL DEFAULT 'provisioned'
        CHECK (origin IN ('bootstrap', 'invitation', 'registration', 'provisioned')),
    ADD COLUMN disabled_by uuid REFERENCES unoa.account(id),
    ADD COLUMN disabled_reason text CHECK (disabled_reason IS NULL OR length(btrim(disabled_reason)) BETWEEN 1 AND 500);

-- The permission catalogue lists the checks the code performs. It is
-- technical, not academic content: roles composing it are created by the
-- administration.
ALTER TABLE unoa.permission
    ADD COLUMN module text CHECK (module IS NULL OR module ~ '^[A-Z0-9]{2,8}$'),
    ADD COLUMN label text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 200),
    ADD COLUMN sensitive boolean NOT NULL DEFAULT false;

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('iam.read', 'IAM', 'Consulter les comptes, rôles et attributions', false),
    ('iam.manage', 'IAM', 'Composer les rôles et inviter des comptes', true),
    ('iam.assign', 'IAM', 'Attribuer et retirer des rôles', true),
    ('iam.delegate', 'IAM', 'Déléguer temporairement un rôle détenu', true),
    ('iam.accounts', 'IAM', 'Désactiver un compte et révoquer ses sessions', true),
    ('audit.read', 'IAM', 'Consulter le journal d’audit', true),
    ('config.read', 'CFG', 'Consulter les paramètres', false),
    ('config.write', 'CFG', 'Proposer des valeurs de paramètres', false),
    ('config.define', 'CFG', 'Définir des paramètres', true),
    ('config.review', 'CFG', 'Approuver des valeurs de paramètres', true),
    ('config.publish', 'CFG', 'Publier des valeurs de paramètres', true),
    ('territory.read', 'TEN', 'Consulter les territoires', false),
    ('territory.write', 'TEN', 'Créer et modifier des territoires', true),
    ('territory.define', 'TEN', 'Définir les types de territoires', true),
    ('org.read', 'ORG', 'Consulter les structures et postes', false),
    ('org.write', 'ORG', 'Créer et modifier des structures et postes', false),
    ('org.approve', 'ORG', 'Approuver les changements de structure et nominations', true),
    ('catalog.read', 'CAT', 'Consulter le catalogue', false),
    ('catalog.write', 'CAT', 'Rédiger programmes, maquettes et cours', false),
    ('catalog.review', 'CAT', 'Relire une version de programme', true),
    ('catalog.publish', 'CAT', 'Publier une version de programme', true),
    ('catalog.authorize', 'CAT', 'Vérifier une autorisation réglementaire', true),
    ('catalog.define', 'CAT', 'Définir les référentiels du catalogue', true),
    ('lms.read', 'LMS', 'Consulter le studio des cours', false),
    ('lms.write', 'LMS', 'Rédiger des contenus de cours', false),
    ('lms.review', 'LMS', 'Valider une version de cours', true),
    ('lms.manage', 'LMS', 'Ouvrir des offres et gérer les promotions', false),
    ('site.read', 'CMS', 'Consulter le site public', false),
    ('site.write', 'CMS', 'Rédiger les textes du site', false),
    ('site.publish', 'CMS', 'Publier le site et ses textes', true),
    ('adm.read', 'ADM', 'Consulter les campagnes et dossiers', false),
    ('adm.manage', 'ADM', 'Configurer et ouvrir les campagnes', false),
    ('adm.review', 'ADM', 'Instruire les dossiers', false),
    ('adm.decide', 'ADM', 'Rendre les décisions d’admission', true),
    ('adm.appeal', 'ADM', 'Statuer sur les recours', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;

ALTER TABLE unoa.access_role
    ADD COLUMN label text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 120),
    ADD COLUMN description text CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 1000),
    ADD COLUMN system boolean NOT NULL DEFAULT false,
    ADD COLUMN created_by uuid REFERENCES unoa.account(id),
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN archived_at timestamptz;

-- The bootstrap role holds every permission of the catalogue, now and later.
INSERT INTO unoa.access_role(code, label, description, system)
VALUES ('platform_admin', 'Administrateur de la plateforme', 'Rôle d’amorçage : toutes les permissions du catalogue.', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT 'platform_admin', code FROM unoa.permission ON CONFLICT DO NOTHING;

CREATE FUNCTION unoa.extend_system_role() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    INSERT INTO unoa.role_permission(role_code, permission_code)
    SELECT code, NEW.code FROM unoa.access_role WHERE system ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;
CREATE TRIGGER extend_system_role AFTER INSERT ON unoa.permission
FOR EACH ROW EXECUTE FUNCTION unoa.extend_system_role();

CREATE FUNCTION unoa.protect_system_role() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_TABLE_NAME = 'access_role' THEN
        IF OLD.system AND (NEW.code IS DISTINCT FROM OLD.code OR NOT NEW.system OR NEW.archived_at IS NOT NULL) THEN
            RAISE EXCEPTION 'The bootstrap role is not changed' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM unoa.access_role WHERE code = OLD.role_code AND system) THEN
        RAISE EXCEPTION 'The bootstrap role keeps every permission' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER protect_system_role BEFORE UPDATE ON unoa.access_role
FOR EACH ROW EXECUTE FUNCTION unoa.protect_system_role();
CREATE TRIGGER protect_system_role_permissions BEFORE DELETE ON unoa.role_permission
FOR EACH ROW EXECUTE FUNCTION unoa.protect_system_role();

ALTER TABLE unoa.role_grant
    ADD COLUMN granted_by uuid REFERENCES unoa.account(id),
    ADD COLUMN granted_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 500),
    ADD COLUMN delegated_from uuid REFERENCES unoa.role_grant(id),
    ADD COLUMN revoked_by uuid REFERENCES unoa.account(id),
    ADD COLUMN revoke_reason text CHECK (revoke_reason IS NULL OR length(btrim(revoke_reason)) BETWEEN 1 AND 500),
    ADD CONSTRAINT role_grant_no_self CHECK (granted_by IS NULL OR granted_by <> account_id),
    ADD CONSTRAINT role_grant_delegation CHECK (delegated_from IS NULL OR (effective_until IS NOT NULL AND reason IS NOT NULL));

CREATE INDEX role_grant_scope ON unoa.role_grant(scope_id);

-- A grant is written once; only its revocation is recorded afterwards.
CREATE FUNCTION unoa.validate_role_grant() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'A grant is revoked, never deleted' USING ERRCODE = '23514';
    END IF;
    IF ROW(NEW.id, NEW.account_id, NEW.role_code, NEW.scope_id, NEW.include_descendants, NEW.effective_from,
           NEW.granted_by, NEW.granted_at, NEW.reason, NEW.delegated_from)
        IS DISTINCT FROM ROW(OLD.id, OLD.account_id, OLD.role_code, OLD.scope_id, OLD.include_descendants, OLD.effective_from,
           OLD.granted_by, OLD.granted_at, OLD.reason, OLD.delegated_from)
        OR (NEW.effective_until IS DISTINCT FROM OLD.effective_until AND (NEW.effective_until IS NULL
            OR (OLD.effective_until IS NOT NULL AND NEW.effective_until > OLD.effective_until)))
        OR (OLD.revoked_at IS NOT NULL AND ROW(NEW.revoked_at, NEW.revoked_by, NEW.revoke_reason)
            IS DISTINCT FROM ROW(OLD.revoked_at, OLD.revoked_by, OLD.revoke_reason)) THEN
        RAISE EXCEPTION 'A grant is only shortened or revoked' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_role_grant BEFORE UPDATE OR DELETE ON unoa.role_grant
FOR EACH ROW EXECUTE FUNCTION unoa.validate_role_grant();

-- Anti-escalation: an actor grants a role only if they may assign in that
-- scope and already hold every permission of the role there.
CREATE FUNCTION unoa.can_grant(actor uuid, target_role text, target_scope uuid, assign_permission text DEFAULT 'iam.assign')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT unoa.has_scope_permission(actor, assign_permission, target_scope)
       AND EXISTS (SELECT 1 FROM unoa.access_role WHERE code = target_role AND archived_at IS NULL)
       AND NOT EXISTS (
           SELECT 1 FROM unoa.role_permission AS item
           WHERE item.role_code = target_role AND NOT unoa.has_scope_permission(actor, item.permission_code, target_scope)
       );
$$;

-- An actor reaches an account when they hold the permission over every scope
-- where it holds a current grant; an account without grant needs the root.
CREATE FUNCTION unoa.covers_account(actor uuid, requested_permission text, target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM unoa.role_grant WHERE account_id = target AND revoked_at IS NULL
          AND (effective_until IS NULL OR effective_until > statement_timestamp())
    ) THEN NOT EXISTS (
        SELECT 1 FROM unoa.role_grant AS assignment
        WHERE assignment.account_id = target AND assignment.revoked_at IS NULL
          AND (assignment.effective_until IS NULL OR assignment.effective_until > statement_timestamp())
          AND NOT unoa.has_scope_permission(actor, requested_permission, assignment.scope_id)
    ) ELSE unoa.has_scope_permission(actor, requested_permission, (SELECT id FROM unoa.scope WHERE parent_id IS NULL))
    END;
$$;

CREATE TABLE unoa.invitation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
    email text CHECK (email IS NULL OR (length(email) <= 254 AND email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
    role_code text NOT NULL REFERENCES unoa.access_role(code),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    include_descendants boolean NOT NULL DEFAULT true,
    grant_until timestamptz,
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    invited_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz,
    accepted_account uuid REFERENCES unoa.account(id),
    revoked_at timestamptz,
    revoked_by uuid REFERENCES unoa.account(id),
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days'),
    CHECK (grant_until IS NULL OR grant_until > created_at),
    CHECK ((accepted_at IS NULL) = (accepted_account IS NULL)),
    CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX invitation_scope ON unoa.invitation(scope_id, created_at DESC);

CREATE FUNCTION unoa.validate_invitation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' OR ROW(NEW.id, NEW.token_hash, NEW.display_name, NEW.email, NEW.role_code, NEW.scope_id,
        NEW.include_descendants, NEW.grant_until, NEW.reason, NEW.invited_by, NEW.created_at, NEW.expires_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.token_hash, OLD.display_name, OLD.email, OLD.role_code, OLD.scope_id,
        OLD.include_descendants, OLD.grant_until, OLD.reason, OLD.invited_by, OLD.created_at, OLD.expires_at)
        OR OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'An invitation is immutable once sent' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_invitation BEFORE UPDATE OR DELETE ON unoa.invitation
FOR EACH ROW EXECUTE FUNCTION unoa.validate_invitation();

-- Open registration is decided per public site (candidates, learners).
ALTER TABLE unoa.site ADD COLUMN open_registration boolean NOT NULL DEFAULT false;

-- Accepting an invitation links the authenticated identity to an account
-- (created if needed: one person, one account) and records the grant.
CREATE FUNCTION unoa.accept_invitation(token bytea, identity_issuer text, identity_subject text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    pending unoa.invitation%ROWTYPE;
    holder uuid;
BEGIN
    SELECT * INTO pending FROM unoa.invitation WHERE token_hash = token FOR UPDATE;
    IF NOT FOUND OR pending.accepted_at IS NOT NULL OR pending.revoked_at IS NOT NULL
        OR pending.expires_at <= statement_timestamp() THEN
        RETURN NULL;
    END IF;
    SELECT account_id INTO holder FROM unoa.login_identity WHERE issuer = identity_issuer AND subject = identity_subject;
    IF holder IS NULL THEN
        INSERT INTO unoa.account(display_name, email, origin) VALUES (pending.display_name, pending.email, 'invitation')
        RETURNING id INTO holder;
        INSERT INTO unoa.login_identity(issuer, subject, account_id) VALUES (identity_issuer, identity_subject, holder);
    ELSIF EXISTS (SELECT 1 FROM unoa.account WHERE id = holder AND disabled_at IS NOT NULL) OR holder = pending.invited_by THEN
        RETURN NULL;
    END IF;
    UPDATE unoa.invitation SET accepted_at = statement_timestamp(), accepted_account = holder WHERE id = pending.id;
    INSERT INTO unoa.role_grant(account_id, role_code, scope_id, include_descendants, effective_from, effective_until, granted_by, reason)
    VALUES (holder, pending.role_code, pending.scope_id, pending.include_descendants, statement_timestamp(), pending.grant_until,
            pending.invited_by, pending.reason);
    INSERT INTO unoa.audit_event(actor_id, scope_id, action, correlation_id, resource_id, outcome)
    VALUES (holder, pending.scope_id, 'iam.invitation_accepted', gen_random_uuid(), pending.id, 'allowed');
    RETURN holder;
END;
$$;

-- Self-registration on a site that allows it: an account without any role.
CREATE FUNCTION unoa.register_account(target_site uuid, identity_issuer text, identity_subject text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    holder uuid;
BEGIN
    SELECT account_id INTO holder FROM unoa.login_identity WHERE issuer = identity_issuer AND subject = identity_subject;
    IF holder IS NOT NULL THEN
        RETURN holder;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unoa.site WHERE id = target_site AND online AND open_registration) THEN
        RETURN NULL;
    END IF;
    INSERT INTO unoa.account(origin) VALUES ('registration') RETURNING id INTO holder;
    INSERT INTO unoa.login_identity(issuer, subject, account_id) VALUES (identity_issuer, identity_subject, holder);
    INSERT INTO unoa.audit_event(actor_id, scope_id, action, correlation_id, resource_id, outcome)
    SELECT holder, scope_id, 'iam.account_registered', gen_random_uuid(), holder, 'allowed' FROM unoa.site WHERE id = target_site;
    RETURN holder;
END;
$$;

-- Bootstrap of the first administrator, run once by the database owner
-- (command line or Neon SQL editor). Refused once an administrator exists.
CREATE FUNCTION unoa.bootstrap_platform(identity_issuer text, identity_subject text, administrator text,
    contact text, platform_type text, platform_label text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    root uuid;
    holder uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM unoa.role_grant WHERE role_code = 'platform_admin' AND revoked_at IS NULL) THEN
        RAISE EXCEPTION 'A platform administrator already exists' USING ERRCODE = '23514';
    END IF;
    SELECT id INTO root FROM unoa.scope WHERE parent_id IS NULL;
    IF root IS NULL THEN
        INSERT INTO unoa.scope_type(code, label, nature) VALUES (platform_type, platform_label, 'platform')
        ON CONFLICT (code) DO NOTHING;
        INSERT INTO unoa.scope(type_code, label, present_from) VALUES (platform_type, platform_label, statement_timestamp() - interval '1 minute')
        RETURNING id INTO root;
    END IF;
    SELECT account_id INTO holder FROM unoa.login_identity WHERE issuer = identity_issuer AND subject = identity_subject;
    IF holder IS NULL THEN
        INSERT INTO unoa.account(display_name, email, origin) VALUES (administrator, contact, 'bootstrap') RETURNING id INTO holder;
        INSERT INTO unoa.login_identity(issuer, subject, account_id) VALUES (identity_issuer, identity_subject, holder);
    END IF;
    INSERT INTO unoa.role_grant(account_id, role_code, scope_id, include_descendants, effective_from, reason)
    VALUES (holder, 'platform_admin', root, true, statement_timestamp(), 'Amorçage de la plateforme');
    INSERT INTO unoa.audit_event(actor_id, scope_id, action, correlation_id, resource_id, outcome)
    VALUES (holder, root, 'iam.bootstrap', gen_random_uuid(), holder, 'allowed');
    RETURN holder;
END;
$$;

-- Refusals use the application SQLSTATE U0403, reported as HTTP 403.
-- Every administrative write goes through these functions: the web role
-- never writes grants, roles or the audit trail directly. The actor comes from
-- trusted server state (the session), as for has_scope_permission.

CREATE FUNCTION unoa.iam_root() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, unoa, pg_temp
AS $$ SELECT id FROM unoa.scope WHERE parent_id IS NULL $$;

CREATE FUNCTION unoa.iam_audit(actor uuid, target_scope uuid, action text, resource uuid, correlation uuid)
RETURNS void
LANGUAGE sql SET search_path = pg_catalog, unoa, pg_temp
AS $$
    INSERT INTO unoa.audit_event(actor_id, scope_id, action, correlation_id, resource_id, outcome)
    VALUES (actor, target_scope, action, correlation, resource, 'allowed');
$$;

CREATE FUNCTION unoa.compose_role(actor uuid, role text, role_label text, role_description text, permissions text[], correlation uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    root uuid := unoa.iam_root();
    current unoa.access_role%ROWTYPE;
    existed boolean;
BEGIN
    IF NOT unoa.has_scope_permission(actor, 'iam.manage', root) THEN
        RAISE EXCEPTION 'Role composition refused' USING ERRCODE = 'U0403';
    END IF;
    IF cardinality(permissions) = 0 OR EXISTS (SELECT 1 FROM unnest(permissions) AS item(code)
        WHERE NOT EXISTS (SELECT 1 FROM unoa.permission WHERE permission.code = item.code)) THEN
        RAISE EXCEPTION 'Unknown permission' USING ERRCODE = '23514';
    END IF;
    -- No one composes a role with powers they do not hold themselves.
    IF EXISTS (SELECT 1 FROM unnest(permissions) AS item(code) WHERE NOT unoa.has_scope_permission(actor, item.code, root)) THEN
        RAISE EXCEPTION 'Role composition beyond the actor permissions' USING ERRCODE = 'U0403';
    END IF;
    SELECT * INTO current FROM unoa.access_role WHERE code = role FOR UPDATE;
    existed := FOUND;
    IF existed AND (current.system OR current.archived_at IS NOT NULL) THEN
        RAISE EXCEPTION 'This role is not edited' USING ERRCODE = '23514';
    END IF;
    IF existed THEN
        UPDATE unoa.access_role SET label = role_label, description = role_description WHERE code = role;
        DELETE FROM unoa.role_permission WHERE role_code = role AND permission_code <> ALL (permissions);
    ELSE
        INSERT INTO unoa.access_role(code, label, description, created_by) VALUES (role, role_label, role_description, actor);
    END IF;
    INSERT INTO unoa.role_permission(role_code, permission_code)
    SELECT role, item.code FROM unnest(permissions) AS item(code) ON CONFLICT DO NOTHING;
    PERFORM unoa.iam_audit(actor, root, CASE WHEN existed THEN 'iam.role_changed' ELSE 'iam.role_created' END, NULL, correlation);
END;
$$;

CREATE FUNCTION unoa.archive_role(actor uuid, role text, correlation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF NOT unoa.has_scope_permission(actor, 'iam.manage', unoa.iam_root()) THEN
        RAISE EXCEPTION 'Role archiving refused' USING ERRCODE = 'U0403';
    END IF;
    IF EXISTS (SELECT 1 FROM unoa.role_grant WHERE role_code = role AND revoked_at IS NULL
        AND (effective_until IS NULL OR effective_until > statement_timestamp())) THEN
        RAISE EXCEPTION 'A role still granted is not archived' USING ERRCODE = '23514';
    END IF;
    UPDATE unoa.access_role SET archived_at = statement_timestamp() WHERE code = role AND archived_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Role not found' USING ERRCODE = 'P0002';
    END IF;
    PERFORM unoa.iam_audit(actor, unoa.iam_root(), 'iam.role_archived', NULL, correlation);
END;
$$;

CREATE FUNCTION unoa.grant_role(actor uuid, target uuid, role text, target_scope uuid, descendants boolean,
    until timestamptz, justification text, correlation uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    created uuid;
BEGIN
    IF NOT unoa.can_grant(actor, role, target_scope) OR actor = target THEN
        RAISE EXCEPTION 'Grant refused' USING ERRCODE = 'U0403';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unoa.account WHERE id = target AND disabled_at IS NULL) THEN
        RAISE EXCEPTION 'Account unavailable' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO unoa.role_grant(account_id, role_code, scope_id, include_descendants, effective_from, effective_until, granted_by, reason)
    VALUES (target, role, target_scope, descendants, statement_timestamp(), until, actor, justification) RETURNING id INTO created;
    PERFORM unoa.iam_audit(actor, target_scope, 'iam.role_granted', created, correlation);
    RETURN created;
END;
$$;

-- Revoking a grant also ends the delegations made from it.
CREATE FUNCTION unoa.revoke_grant(actor uuid, target uuid, justification text, correlation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    found_grant unoa.role_grant%ROWTYPE;
BEGIN
    SELECT * INTO found_grant FROM unoa.role_grant WHERE id = target FOR UPDATE;
    IF NOT FOUND OR found_grant.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Grant not found' USING ERRCODE = 'P0002';
    END IF;
    IF found_grant.account_id = actor OR NOT (unoa.can_grant(actor, found_grant.role_code, found_grant.scope_id)
        OR (found_grant.delegated_from IS NOT NULL AND found_grant.granted_by = actor)) THEN
        RAISE EXCEPTION 'Revocation refused' USING ERRCODE = 'U0403';
    END IF;
    UPDATE unoa.role_grant SET revoked_at = statement_timestamp(), revoked_by = actor, revoke_reason = justification
    WHERE (id = target OR delegated_from = target) AND revoked_at IS NULL;
    PERFORM unoa.iam_audit(actor, found_grant.scope_id, 'iam.role_revoked', target, correlation);
END;
$$;

-- A holder lends one of their current grants for a bounded period.
CREATE FUNCTION unoa.delegate_grant(actor uuid, source uuid, target uuid, until timestamptz, justification text, correlation uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    found_grant unoa.role_grant%ROWTYPE;
    created uuid;
BEGIN
    SELECT * INTO found_grant FROM unoa.role_grant WHERE id = source;
    IF NOT FOUND OR found_grant.account_id <> actor OR found_grant.revoked_at IS NOT NULL OR found_grant.delegated_from IS NOT NULL
        OR found_grant.effective_from > statement_timestamp()
        OR (found_grant.effective_until IS NOT NULL AND found_grant.effective_until <= statement_timestamp())
        OR NOT unoa.has_scope_permission(actor, 'iam.delegate', found_grant.scope_id) OR target = actor THEN
        RAISE EXCEPTION 'Delegation refused' USING ERRCODE = 'U0403';
    END IF;
    IF until <= statement_timestamp() OR until > statement_timestamp() + interval '90 days'
        OR (found_grant.effective_until IS NOT NULL AND until > found_grant.effective_until) THEN
        RAISE EXCEPTION 'Delegation period refused' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unoa.account WHERE id = target AND disabled_at IS NULL) THEN
        RAISE EXCEPTION 'Account unavailable' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO unoa.role_grant(account_id, role_code, scope_id, include_descendants, effective_from, effective_until,
        granted_by, reason, delegated_from)
    VALUES (target, found_grant.role_code, found_grant.scope_id, found_grant.include_descendants, statement_timestamp(), until,
        actor, justification, source) RETURNING id INTO created;
    PERFORM unoa.iam_audit(actor, found_grant.scope_id, 'iam.role_delegated', created, correlation);
    RETURN created;
END;
$$;

CREATE FUNCTION unoa.invite_account(actor uuid, token bytea, invitee text, contact text, role text, target_scope uuid,
    descendants boolean, until timestamptz, justification text, valid_days integer, correlation uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    created uuid;
BEGIN
    IF NOT unoa.can_grant(actor, role, target_scope) OR NOT unoa.has_scope_permission(actor, 'iam.manage', target_scope) THEN
        RAISE EXCEPTION 'Invitation refused' USING ERRCODE = 'U0403';
    END IF;
    INSERT INTO unoa.invitation(token_hash, display_name, email, role_code, scope_id, include_descendants, grant_until,
        reason, invited_by, expires_at)
    VALUES (token, invitee, contact, role, target_scope, descendants, until, justification, actor,
        statement_timestamp() + make_interval(days => valid_days)) RETURNING id INTO created;
    PERFORM unoa.iam_audit(actor, target_scope, 'iam.invitation_sent', created, correlation);
    RETURN created;
END;
$$;

CREATE FUNCTION unoa.revoke_invitation(actor uuid, target uuid, correlation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    pending unoa.invitation%ROWTYPE;
BEGIN
    SELECT * INTO pending FROM unoa.invitation WHERE id = target;
    IF NOT FOUND OR NOT unoa.has_scope_permission(actor, 'iam.manage', pending.scope_id) THEN
        RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE unoa.invitation SET revoked_at = statement_timestamp(), revoked_by = actor WHERE id = target;
    PERFORM unoa.iam_audit(actor, pending.scope_id, 'iam.invitation_revoked', target, correlation);
END;
$$;

CREATE FUNCTION unoa.set_account_state(actor uuid, target uuid, disable boolean, justification text, correlation uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF actor = target OR NOT unoa.covers_account(actor, 'iam.accounts', target) THEN
        RAISE EXCEPTION 'Account change refused' USING ERRCODE = 'U0403';
    END IF;
    IF disable THEN
        UPDATE unoa.account SET disabled_at = statement_timestamp(), disabled_by = actor, disabled_reason = justification
        WHERE id = target AND disabled_at IS NULL;
    ELSE
        UPDATE unoa.account SET disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = target AND disabled_at IS NOT NULL;
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Account state unchanged' USING ERRCODE = '23514';
    END IF;
    PERFORM unoa.iam_audit(actor, NULL, CASE WHEN disable THEN 'iam.account_disabled' ELSE 'iam.account_enabled' END, target, correlation);
END;
$$;

CREATE FUNCTION unoa.revoke_account_sessions(actor uuid, target uuid, correlation uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    total integer;
BEGIN
    IF NOT (actor = target OR unoa.covers_account(actor, 'iam.accounts', target)) THEN
        RAISE EXCEPTION 'Session revocation refused' USING ERRCODE = 'U0403';
    END IF;
    UPDATE unoa.login_session SET revoked_at = statement_timestamp()
    WHERE account_id = target AND revoked_at IS NULL AND expires_at > statement_timestamp();
    GET DIAGNOSTICS total = ROW_COUNT;
    PERFORM unoa.iam_audit(actor, NULL, 'iam.sessions_revoked', target, correlation);
    RETURN total;
END;
$$;

-- Read models, limited to the scopes the actor administers.
CREATE FUNCTION unoa.iam_accounts(actor uuid, target_scope uuid, search text)
RETURNS TABLE (id uuid, display_name text, email text, origin text, created_at timestamptz, disabled_at timestamptz,
    grants integer, sessions integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT account.id, account.display_name, account.email, account.origin, account.created_at, account.disabled_at,
        (SELECT count(*)::int FROM unoa.role_grant WHERE account_id = account.id AND revoked_at IS NULL
           AND (effective_until IS NULL OR effective_until > statement_timestamp())),
        (SELECT count(*)::int FROM unoa.login_session WHERE account_id = account.id AND revoked_at IS NULL
           AND expires_at > statement_timestamp())
    FROM unoa.account
    WHERE unoa.has_scope_permission(actor, 'iam.read', target_scope)
      AND (EXISTS (SELECT 1 FROM unoa.role_grant WHERE account_id = account.id AND unoa.scope_within(scope_id, target_scope))
           OR (target_scope = unoa.iam_root()))
      AND (search IS NULL OR account.display_name ILIKE '%' || search || '%' OR account.email ILIKE '%' || search || '%')
    ORDER BY account.display_name NULLS LAST, account.created_at
    LIMIT 200;
$$;

CREATE FUNCTION unoa.iam_account(actor uuid, target uuid)
RETURNS TABLE (grant_id uuid, role_code text, role_label text, scope_id uuid, scope_label text, include_descendants boolean,
    effective_from timestamptz, effective_until timestamptz, revoked_at timestamptz, reason text, revoke_reason text,
    delegated_from uuid, granted_by_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT assignment.id, assignment.role_code, role.label, assignment.scope_id, scope.label, assignment.include_descendants,
        assignment.effective_from, assignment.effective_until, assignment.revoked_at, assignment.reason, assignment.revoke_reason,
        assignment.delegated_from, granter.display_name
    FROM unoa.role_grant AS assignment
    JOIN unoa.access_role AS role ON role.code = assignment.role_code
    JOIN unoa.scope ON scope.id = assignment.scope_id
    LEFT JOIN unoa.account AS granter ON granter.id = assignment.granted_by
    WHERE assignment.account_id = target AND (actor = target OR unoa.has_scope_permission(actor, 'iam.read', assignment.scope_id))
    ORDER BY assignment.revoked_at NULLS FIRST, assignment.effective_from DESC;
$$;

CREATE FUNCTION unoa.iam_sessions(actor uuid, target uuid)
RETURNS TABLE (started_at timestamptz, expires_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT started_at, expires_at, revoked_at FROM unoa.login_session
    WHERE account_id = target AND (actor = target OR unoa.covers_account(actor, 'iam.read', target))
    ORDER BY started_at DESC LIMIT 20;
$$;

CREATE FUNCTION unoa.audit_trail(actor uuid, target_scope uuid, action_prefix text, before timestamptz)
RETURNS TABLE (id uuid, occurred_at timestamptz, action text, outcome text, actor_id uuid, actor_name text,
    scope_id uuid, scope_label text, resource_id uuid, correlation_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT event.id, event.occurred_at, event.action, event.outcome, event.actor_id, author.display_name,
        event.scope_id, scope.label, event.resource_id, event.correlation_id
    FROM unoa.audit_event AS event
    LEFT JOIN unoa.account AS author ON author.id = event.actor_id
    LEFT JOIN unoa.scope ON scope.id = event.scope_id
    WHERE unoa.has_scope_permission(actor, 'audit.read', target_scope)
      AND ((event.scope_id IS NOT NULL AND unoa.scope_within(event.scope_id, target_scope))
           OR (event.scope_id IS NULL AND target_scope = unoa.iam_root()))
      AND (action_prefix IS NULL OR event.action LIKE action_prefix || '%')
      AND (before IS NULL OR event.occurred_at < before)
    ORDER BY event.occurred_at DESC
    LIMIT 100;
$$;

-- What an invited person sees before signing in; the token stays secret.
CREATE FUNCTION unoa.invitation_preview(token bytea)
RETURNS TABLE (display_name text, role_label text, scope_label text, expires_at timestamptz, state text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT invitation.display_name, coalesce(role.label, role.code), scope.label, invitation.expires_at,
        CASE WHEN invitation.accepted_at IS NOT NULL THEN 'accepted' WHEN invitation.revoked_at IS NOT NULL THEN 'revoked'
             WHEN invitation.expires_at <= statement_timestamp() THEN 'expired' ELSE 'pending' END
    FROM unoa.invitation JOIN unoa.access_role AS role ON role.code = invitation.role_code
    JOIN unoa.scope ON scope.id = invitation.scope_id
    WHERE invitation.token_hash = token;
$$;

REVOKE EXECUTE ON FUNCTION unoa.can_grant(uuid, text, uuid, text), unoa.covers_account(uuid, text, uuid),
    unoa.accept_invitation(bytea, text, text), unoa.register_account(uuid, text, text),
    unoa.bootstrap_platform(text, text, text, text, text, text), unoa.iam_root(), unoa.iam_audit(uuid, uuid, text, uuid, uuid),
    unoa.compose_role(uuid, text, text, text, text[], uuid), unoa.archive_role(uuid, text, uuid),
    unoa.grant_role(uuid, uuid, text, uuid, boolean, timestamptz, text, uuid), unoa.revoke_grant(uuid, uuid, text, uuid),
    unoa.delegate_grant(uuid, uuid, uuid, timestamptz, text, uuid),
    unoa.invite_account(uuid, bytea, text, text, text, uuid, boolean, timestamptz, text, integer, uuid),
    unoa.revoke_invitation(uuid, uuid, uuid), unoa.set_account_state(uuid, uuid, boolean, text, uuid),
    unoa.revoke_account_sessions(uuid, uuid, uuid), unoa.iam_accounts(uuid, uuid, text), unoa.iam_account(uuid, uuid),
    unoa.iam_sessions(uuid, uuid), unoa.audit_trail(uuid, uuid, text, timestamptz), unoa.invitation_preview(bytea) FROM PUBLIC;
