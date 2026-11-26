-- Each level sees and acts only at its level (owner's decision, ADR-0016):
-- the country administrator manages countries and establishments only; the
-- rector and the dean no longer write the catalogue or courses (heads of
-- department do), they read, validate and monitor.

DELETE FROM unoa.role_permission WHERE role_code = 'country_admin'
  AND permission_code NOT IN ('territory.read', 'territory.write', 'iam.read', 'iam.manage', 'iam.assign', 'iam.accounts', 'iam.delegate', 'audit.read', 'config.read');
DELETE FROM unoa.role_permission WHERE role_code = 'institution_admin'
  AND permission_code IN ('catalog.write', 'catalog.define', 'lms.write', 'lms.manage', 'ass.author', 'ass.grade', 'grd.enter');
DELETE FROM unoa.role_permission WHERE role_code = 'dean'
  AND permission_code IN ('catalog.write', 'catalog.define', 'lms.write', 'lms.manage');
DELETE FROM unoa.role_permission WHERE role_code = 'department_head' AND permission_code = 'catalog.define';
INSERT INTO unoa.role_permission(role_code, permission_code) VALUES ('department_head', 'tea.verify') ON CONFLICT DO NOTHING;

-- The head of a level (or of the level above) names the head and the system
-- staff templates of its level without holding all their permissions: the
-- nomination follows the cascade. Composed (custom) roles keep the strict
-- anti-escalation rule, and nobody but a platform administrator names one.
CREATE FUNCTION unoa.cascade_names(actor uuid, target_role text, target_scope uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT target_role <> 'platform_admin' AND target_role IN (
        'country_admin', 'territory_manager', 'config_manager', 'auditor', 'institution_admin', 'academic_manager', 'program_manager', 'teacher',
        'pedagogical_reviewer', 'admissions_officer', 'admissions_jury', 'appeals_committee', 'registrar', 'registrar_validator', 'site_editor',
        'communication_manager', 'council_secretary', 'hr_officer', 'exam_officer', 'finance_officer', 'finance_controller', 'documents_officer',
        'documents_signatory', 'short_manager', 'trainer', 'doctoral_school_director', 'research_director', 'dean', 'department_head')
      AND coalesce(unoa.cascade_allows(actor, target_role, target_scope), false)
      AND EXISTS (SELECT 1 FROM unoa.role_grant AS grant_row JOIN unoa.scope ON scope.id = target_scope
          WHERE grant_row.account_id = actor AND grant_row.revoked_at IS NULL AND grant_row.effective_from <= statement_timestamp()
            AND (grant_row.effective_until IS NULL OR grant_row.effective_until > statement_timestamp())
            AND ((grant_row.scope_id = unoa.cascade_anchor(target_scope) AND grant_row.role_code = unoa.cascade_head(unoa.cascade_anchor(target_scope)))
              OR (scope.parent_id IS NOT NULL AND grant_row.scope_id = unoa.cascade_anchor(scope.parent_id)
                  AND grant_row.role_code = unoa.cascade_head(unoa.cascade_anchor(scope.parent_id)))));
$$;

CREATE OR REPLACE FUNCTION unoa.can_grant(actor uuid, target_role text, target_scope uuid, assign_permission text DEFAULT 'iam.assign')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT unoa.has_scope_permission(actor, assign_permission, target_scope)
       AND EXISTS (SELECT 1 FROM unoa.access_role WHERE code = target_role AND archived_at IS NULL)
       AND (NOT EXISTS (
           SELECT 1 FROM unoa.role_permission AS item
           WHERE item.role_code = target_role AND NOT unoa.has_scope_permission(actor, item.permission_code, target_scope)
       ) OR unoa.cascade_names(actor, target_role, target_scope));
$$;
