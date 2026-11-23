-- Administration hierarchy chosen by the owner (23 November 2026), within the
-- configurable scopes of the TDR: platform (super-administrator) → territory
-- (country administrator) → institution or campus (institution administrator)
-- → academic unit (dean, head of department) → teaching. Role templates remain
-- editable; a role is granted only on a scope of its level or below.

ALTER TABLE unoa.access_role DROP CONSTRAINT access_role_level_check;
ALTER TABLE unoa.access_role ADD CONSTRAINT access_role_level_check CHECK (level IN ('platform', 'territory', 'institution', 'unit'));

UPDATE unoa.access_role SET label = 'Super-administrateur',
    description = 'Crée les territoires (pays) et nomme leurs administrateurs ; règle la plateforme. Toutes les permissions.' WHERE code = 'platform_admin';
UPDATE unoa.access_role SET label = 'Administrateur d’établissement (campus)', ordinal = 40,
    description = 'Dans son établissement ou campus : crée les facultés, les départements, les filières, les formations et les cours ; nomme doyens, chefs de département et enseignants ; site, admissions, scolarité.'
    WHERE code = 'institution_admin';
UPDATE unoa.access_role SET description = 'Aide le super-administrateur : territoires, établissements et campus, fuseaux, monnaies et langues.' WHERE code = 'territory_manager';

INSERT INTO unoa.access_role(code, label, description, level, ordinal) VALUES
    ('country_admin', 'Administrateur pays',
     'Dans son pays (ou territoire) : crée les établissements universitaires et leurs campus, et nomme leurs administrateurs.', 'territory', 5),
    ('dean', 'Doyen ou responsable de faculté',
     'Dans sa faculté : crée et fait évoluer les départements, valide les formations et les cours, nomme les chefs de département.', 'unit', 45),
    ('department_head', 'Chef de département',
     'Dans son département : crée les filières, formations et cours, nomme les enseignants et valide leurs contenus.', 'unit', 48)
ON CONFLICT (code) DO NOTHING;

-- The country administrator holds the establishment administrator's
-- permissions on its territory (to name them, MATRICE_ACCES anti-escalation)
-- plus the territorial register below its territory.
INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT 'country_admin', permission_code FROM unoa.role_permission WHERE role_code = 'institution_admin'
UNION SELECT 'country_admin', unnest(ARRAY['territory.read', 'territory.write'])
ON CONFLICT DO NOTHING;

INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES
    ('dean', 'iam.read'), ('dean', 'iam.manage'), ('dean', 'iam.assign'), ('dean', 'org.read'), ('dean', 'org.write'), ('dean', 'org.approve'),
    ('dean', 'catalog.read'), ('dean', 'catalog.write'), ('dean', 'catalog.review'), ('dean', 'catalog.publish'), ('dean', 'catalog.define'),
    ('dean', 'lms.read'), ('dean', 'lms.write'), ('dean', 'lms.review'), ('dean', 'lms.manage'), ('dean', 'adm.read'), ('dean', 'sis.read'),
    ('department_head', 'iam.read'), ('department_head', 'iam.manage'), ('department_head', 'iam.assign'), ('department_head', 'org.read'),
    ('department_head', 'catalog.read'), ('department_head', 'catalog.write'), ('department_head', 'catalog.review'), ('department_head', 'catalog.define'),
    ('department_head', 'lms.read'), ('department_head', 'lms.write'), ('department_head', 'lms.review'), ('department_head', 'lms.manage'),
    ('department_head', 'sis.read')
) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.permission WHERE code = item.permission)
ON CONFLICT DO NOTHING;

-- Natures where each level may be granted.
CREATE FUNCTION unoa.role_level_allows(role text, target_scope uuid) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT CASE role_row.level
        WHEN 'platform' THEN target_scope = (SELECT id FROM unoa.scope WHERE parent_id IS NULL)
        WHEN 'territory' THEN kind.nature IN ('territory', 'jurisdiction')
        WHEN 'institution' THEN kind.nature IN ('institution', 'centre', 'academic_unit')
        WHEN 'unit' THEN kind.nature = 'academic_unit'
    END
    FROM unoa.access_role AS role_row, unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE role_row.code = role AND scope.id = target_scope;
$$;

CREATE OR REPLACE FUNCTION unoa.grant_role(actor uuid, target uuid, role text, target_scope uuid, descendants boolean,
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
    IF NOT coalesce(unoa.role_level_allows(role, target_scope), false) THEN
        RAISE EXCEPTION 'This role is granted on another level of the hierarchy' USING ERRCODE = '23514';
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

-- Invitations follow the same level rule.
CREATE OR REPLACE FUNCTION unoa.invite_account(actor uuid, token bytea, invitee text, contact text, role text, target_scope uuid,
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
    IF NOT coalesce(unoa.role_level_allows(role, target_scope), false) THEN
        RAISE EXCEPTION 'This role is granted on another level of the hierarchy' USING ERRCODE = '23514';
    END IF;
    INSERT INTO unoa.invitation(token_hash, display_name, email, role_code, scope_id, include_descendants, grant_until,
        reason, invited_by, expires_at)
    VALUES (token, invitee, contact, role, target_scope, descendants, until, justification, actor,
        statement_timestamp() + make_interval(days => valid_days)) RETURNING id INTO created;
    PERFORM unoa.iam_audit(actor, target_scope, 'iam.invitation_sent', created, correlation);
    RETURN created;
END;
$$;

-- The super-administrator sets the level of a composed role.
CREATE FUNCTION unoa.set_role_level(actor uuid, role text, new_level text, correlation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF NOT unoa.has_scope_permission(actor, 'iam.manage', unoa.iam_root()) THEN
        RAISE EXCEPTION 'Role level refused' USING ERRCODE = 'U0403';
    END IF;
    UPDATE unoa.access_role SET level = new_level WHERE code = role AND NOT system AND archived_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Role not found' USING ERRCODE = 'P0002';
    END IF;
    PERFORM unoa.iam_audit(actor, unoa.iam_root(), 'iam.role_level_set', NULL, correlation);
END;
$$;

REVOKE EXECUTE ON FUNCTION unoa.role_level_allows(text, uuid), unoa.set_role_level(uuid, text, text, uuid) FROM PUBLIC;
