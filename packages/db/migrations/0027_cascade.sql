-- Administrative cascade chosen by the owner (25 November 2026, ADR-0016):
-- each level creates only the level below and names its head, plus its own
-- staff; upper levels keep reading and monitoring through inheritance but no
-- longer create or name further down.
--   super-administrator (platform) → countries, country administrators
--   country administrator → establishments, rectors (and key functions of an establishment)
--   rector / establishment administrator → faculties, deans, campuses, establishment staff
--   dean → departments, heads of department, faculty staff
--   head of department → fields, programmes, courses, teachers, department staff

-- Level of a scope in the cascade, from structure only (types stay configurable).
CREATE FUNCTION unoa.cascade_level(target uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT CASE
        WHEN kind.nature = 'platform' THEN 'platform'
        WHEN kind.nature IN ('territory', 'jurisdiction') THEN 'country'
        WHEN kind.nature = 'institution' THEN 'institution'
        WHEN kind.nature = 'centre' THEN 'centre'
        WHEN kind.nature = 'academic_unit' AND parent_kind.nature = 'academic_unit' THEN 'department'
        WHEN kind.nature = 'academic_unit' THEN 'faculty'
    END
    FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    LEFT JOIN unoa.scope AS parent ON parent.id = scope.parent_id LEFT JOIN unoa.scope_type AS parent_kind ON parent_kind.code = parent.type_code
    WHERE scope.id = target;
$$;

-- The scope whose holders govern a scope: a region is governed from its country
-- (topmost territorial scope), a campus from its establishment, anything else from itself.
CREATE FUNCTION unoa.cascade_anchor(target uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, unoa, pg_temp
AS $$
    WITH RECURSIVE up AS (
        SELECT scope.id, scope.parent_id, kind.nature, 0 AS depth FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code WHERE scope.id = target
        UNION ALL SELECT scope.id, scope.parent_id, kind.nature, up.depth + 1 FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code JOIN up ON scope.id = up.parent_id
    )
    SELECT CASE
        WHEN (SELECT nature FROM up WHERE depth = 0) IN ('territory', 'jurisdiction')
            THEN (SELECT id FROM up WHERE nature IN ('territory', 'jurisdiction') ORDER BY depth DESC LIMIT 1)
        WHEN (SELECT nature FROM up WHERE depth = 0) = 'centre'
            THEN coalesce((SELECT id FROM up WHERE nature = 'institution' ORDER BY depth LIMIT 1), target)
        ELSE target
    END;
$$;

-- A permission held through a grant on exactly this scope (not inherited from above).
CREATE FUNCTION unoa.holds_here(actor uuid, permission text, target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT EXISTS (SELECT 1 FROM unoa.role_grant AS grant_row JOIN unoa.role_permission AS link ON link.role_code = grant_row.role_code
        JOIN unoa.account ON account.id = grant_row.account_id
        WHERE grant_row.account_id = actor AND grant_row.scope_id = target AND link.permission_code = permission AND grant_row.revoked_at IS NULL
          AND grant_row.effective_from <= statement_timestamp() AND (grant_row.effective_until IS NULL OR grant_row.effective_until > statement_timestamp())
          AND account.disabled_at IS NULL);
$$;

-- Creation of an object of `kind` under `parent` (or owned by it, for the catalogue).
CREATE FUNCTION unoa.may_create(actor uuid, permission text, parent uuid, kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT coalesce(unoa.holds_here(actor, permission, unoa.cascade_anchor(parent)) AND CASE kind
        WHEN 'territory' THEN unoa.cascade_level(parent) IN ('platform', 'country')
        WHEN 'institution' THEN unoa.cascade_level(parent) = 'country'
        WHEN 'centre' THEN unoa.cascade_level(parent) = 'institution'
        WHEN 'faculty' THEN unoa.cascade_level(parent) IN ('institution', 'centre')
        WHEN 'department' THEN unoa.cascade_level(parent) = 'faculty'
        WHEN 'catalog' THEN unoa.cascade_level(parent) = 'department'
        ELSE false
    END, false);
$$;

-- Head role of each level (role templates stay editable; these codes are the system templates).
CREATE FUNCTION unoa.cascade_head(target uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT CASE unoa.cascade_level(target) WHEN 'platform' THEN 'platform_admin' WHEN 'country' THEN 'country_admin'
        WHEN 'institution' THEN 'institution_admin' WHEN 'faculty' THEN 'dean' WHEN 'department' THEN 'department_head' END;
$$;

-- Naming: the head of a level is named from the level above; the staff of a
-- level by its own holders (an establishment's key functions also by its country).
CREATE FUNCTION unoa.cascade_allows(actor uuid, role text, target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT CASE
        WHEN scope.parent_id IS NULL THEN unoa.holds_here(actor, 'iam.assign', scope.id)
        WHEN role = unoa.cascade_head(scope.id) THEN unoa.holds_here(actor, 'iam.assign', unoa.cascade_anchor(scope.parent_id))
        ELSE unoa.holds_here(actor, 'iam.assign', unoa.cascade_anchor(scope.id))
            OR (unoa.cascade_level(scope.id) IN ('country', 'institution', 'centre') AND unoa.holds_here(actor, 'iam.assign', unoa.cascade_anchor(scope.parent_id)))
    END
    FROM unoa.scope WHERE scope.id = target;
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
    IF NOT coalesce(unoa.cascade_allows(actor, role, target_scope), false) THEN
        RAISE EXCEPTION 'Each level names the head of the level below and its own staff' USING ERRCODE = 'U0403';
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
    IF NOT coalesce(unoa.cascade_allows(actor, role, target_scope), false) THEN
        RAISE EXCEPTION 'Each level names the head of the level below and its own staff' USING ERRCODE = 'U0403';
    END IF;
    INSERT INTO unoa.invitation(token_hash, display_name, email, role_code, scope_id, include_descendants, grant_until,
        reason, invited_by, expires_at)
    VALUES (token, invitee, contact, role, target_scope, descendants, until, justification, actor,
        statement_timestamp() + make_interval(days => valid_days)) RETURNING id INTO created;
    PERFORM unoa.iam_audit(actor, target_scope, 'iam.invitation_sent', created, correlation);
    RETURN created;
END;
$$;

-- Role wording and the rector title.
UPDATE unoa.access_role SET label = 'Super-administrateur',
    description = 'Crée les pays et nomme leurs administrateurs ; règle la plateforme. Voit tout, ne crée pas les niveaux inférieurs.' WHERE code = 'platform_admin';
UPDATE unoa.access_role SET description = 'Dans son pays : crée les établissements (universités, campus) et nomme leur recteur et leurs fonctions clés ; suit les établissements.' WHERE code = 'country_admin';
UPDATE unoa.access_role SET label = 'Recteur ou administrateur d’établissement',
    description = 'Dans son établissement : crée les facultés et nomme les doyens ; nomme l’équipe administrative (scolarité, finances, documents, notes…) ; suit les facultés.' WHERE code = 'institution_admin';
UPDATE unoa.access_role SET description = 'Dans sa faculté : crée les départements et nomme les chefs de département ; nomme l’équipe de la faculté ; suit les départements.' WHERE code = 'dean';
UPDATE unoa.access_role SET description = 'Dans son département : crée les filières, spécialités, formations et matières ; recrute et nomme les enseignants.' WHERE code = 'department_head';
