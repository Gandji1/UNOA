-- Roles by cascade level, with plain names (owner's request, ADR-0016): when
-- naming someone on a scope, only the roles of that level are offered and
-- accepted — the head of the level first, then its staff.

ALTER TABLE unoa.access_role ADD COLUMN cascade_levels text[]
    CHECK (cascade_levels IS NULL OR cascade_levels <@ ARRAY['platform', 'country', 'institution', 'centre', 'faculty', 'department']);

UPDATE unoa.access_role AS role SET cascade_levels = item.levels, label = coalesce(item.label, role.label), ordinal = coalesce(item.ordinal, role.ordinal)
FROM (VALUES
    ('platform_admin', ARRAY['platform'], 'Super-administrateur', 1),
    ('territory_manager', ARRAY['platform'], NULL, NULL), ('config_manager', ARRAY['platform'], NULL, NULL), ('auditor', ARRAY['platform', 'country', 'institution'], NULL, NULL),
    ('country_admin', ARRAY['country'], 'Administrateur pays', 2),
    ('institution_admin', ARRAY['institution', 'centre'], 'Recteur (administrateur d’établissement)', 3),
    ('dean', ARRAY['faculty'], 'Doyen (administrateur de faculté)', 4),
    ('department_head', ARRAY['department'], 'Chef de département (administrateur de département)', 5),
    ('academic_manager', ARRAY['institution'], 'Responsable académique de l’établissement', NULL),
    ('registrar', ARRAY['institution', 'faculty'], 'Scolarité', NULL),
    ('registrar_validator', ARRAY['institution', 'faculty'], 'Validation de la scolarité', NULL),
    ('admissions_officer', ARRAY['institution', 'faculty'], 'Gestionnaire des admissions', NULL),
    ('admissions_jury', ARRAY['institution', 'faculty', 'department'], 'Jury d’admission', NULL),
    ('appeals_committee', ARRAY['institution'], 'Commission de recours', NULL),
    ('site_editor', ARRAY['institution'], 'Rédacteur du site', NULL),
    ('communication_manager', ARRAY['institution'], 'Communication et notifications', NULL),
    ('council_secretary', ARRAY['institution', 'faculty'], 'Secrétariat des conseils', NULL),
    ('hr_officer', ARRAY['institution', 'faculty'], 'Ressources humaines enseignants', NULL),
    ('exam_officer', ARRAY['institution', 'faculty'], 'Gestionnaire des notes et jurys', NULL),
    ('finance_officer', ARRAY['institution'], 'Comptable (gestionnaire financier)', NULL),
    ('finance_controller', ARRAY['institution'], 'Contrôleur financier', NULL),
    ('documents_officer', ARRAY['institution'], 'Gestionnaire des documents et diplômes', NULL),
    ('documents_signatory', ARRAY['institution', 'faculty'], 'Signataire des documents', NULL),
    ('short_manager', ARRAY['institution', 'faculty'], 'Responsable des formations courtes', NULL),
    ('doctoral_school_director', ARRAY['institution'], 'Directeur d’école doctorale', NULL),
    ('research_director', ARRAY['faculty', 'department'], 'Directeur de recherche habilité', NULL),
    ('program_manager', ARRAY['department'], 'Responsable de formation', NULL),
    ('pedagogical_reviewer', ARRAY['faculty', 'department'], 'Validateur pédagogique', NULL),
    ('teacher', ARRAY['department'], 'Enseignant', 6),
    ('trainer', ARRAY['department'], 'Formateur', NULL)
) AS item(code, levels, label, ordinal)
WHERE role.code = item.code;

-- Every level above takes part in selecting teachers on submitted files.
INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES ('country_admin', 'tea.read'), ('country_admin', 'tea.review'),
    ('institution_admin', 'tea.review'), ('dean', 'tea.review'), ('department_head', 'tea.decide')) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.access_role WHERE code = item.role)
ON CONFLICT DO NOTHING;

CREATE FUNCTION unoa.role_fits(target_role text, target uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT coalesce((SELECT cascade_levels IS NULL OR unoa.cascade_level(target) = ANY(cascade_levels) FROM unoa.access_role WHERE code = target_role), false);
$$;

CREATE OR REPLACE FUNCTION unoa.cascade_allows(actor uuid, role text, target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT unoa.role_fits(role, target) AND CASE
        WHEN scope.parent_id IS NULL THEN unoa.holds_here(actor, 'iam.assign', scope.id)
        WHEN role = unoa.cascade_head(scope.id) THEN unoa.holds_here(actor, 'iam.assign', unoa.cascade_anchor(scope.parent_id))
        ELSE unoa.holds_here(actor, 'iam.assign', unoa.cascade_anchor(scope.id))
            OR (unoa.cascade_level(scope.id) IN ('country', 'institution', 'centre') AND unoa.holds_here(actor, 'iam.assign', unoa.cascade_anchor(scope.parent_id)))
    END
    FROM unoa.scope WHERE scope.id = target;
$$;
