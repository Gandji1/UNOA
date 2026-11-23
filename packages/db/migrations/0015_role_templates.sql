-- Who does what (MATRICE_ACCES §3–4): role templates ready to grant, each with
-- a level (platform or institution) and a place in the console; the
-- super-administrator may edit, archive or add roles. No academic content.

ALTER TABLE unoa.access_role
    ADD COLUMN level text NOT NULL DEFAULT 'institution' CHECK (level IN ('platform', 'institution')),
    ADD COLUMN ordinal integer NOT NULL DEFAULT 100 CHECK (ordinal BETWEEN 0 AND 1000);

UPDATE unoa.access_role SET label = 'Super-administrateur de la plateforme',
    description = 'Crée les territoires et les établissements, nomme les administrateurs d’établissement, règle la plateforme. Toutes les permissions.',
    level = 'platform', ordinal = 0
WHERE code = 'platform_admin';

INSERT INTO unoa.access_role(code, label, description, level, ordinal) VALUES
    ('territory_manager', 'Gestionnaire des territoires et établissements',
     'Crée les territoires, juridictions, établissements et campus (centres) ; règle leurs fuseaux, monnaies et langues.', 'platform', 10),
    ('config_manager', 'Gestionnaire des paramètres',
     'Définit et publie les paramètres hérités par portée (règles régionales, dates d’effet).', 'platform', 20),
    ('auditor', 'Auditeur',
     'Consulte le journal d’audit, les comptes et les dossiers en lecture seule, sans rien modifier.', 'platform', 30),
    ('institution_admin', 'Administrateur d’établissement',
     'Pour son établissement : site public, facultés et départements, formations, admissions, scolarité, cours, notifications ; invite et nomme les responsables.', 'institution', 40),
    ('academic_manager', 'Responsable académique',
     'Crée facultés, départements, filières et spécialités ; rédige, relit et publie les formations, maquettes et matières.', 'institution', 50),
    ('program_manager', 'Responsable de formation',
     'Rédige la maquette et les matières de sa formation, ouvre les offres de cours et suit candidatures et inscrits.', 'institution', 60),
    ('teacher', 'Enseignant',
     'Conçoit ses cours (leçons, vidéos, exercices) et anime ses séances en visioconférence.', 'institution', 70),
    ('pedagogical_reviewer', 'Validateur pédagogique',
     'Relit et valide les cours et les versions de formation rédigés par d’autres.', 'institution', 80),
    ('admissions_officer', 'Gestionnaire des admissions',
     'Configure les campagnes et formulaires, instruit les dossiers, demande les compléments.', 'institution', 90),
    ('admissions_jury', 'Jury d’admission',
     'Rend les décisions d’admission motivées.', 'institution', 100),
    ('appeals_committee', 'Commission de recours',
     'Statue sur les recours contre les décisions d’admission (autre personne que l’auteur de la décision).', 'institution', 110),
    ('registrar', 'Gestionnaire de scolarité',
     'Règle le matricule, crée les cohortes et groupes, inscrit les admis et gère les inscriptions pédagogiques.', 'institution', 120),
    ('registrar_validator', 'Validateur de scolarité',
     'Valide les inscriptions et décide des changements de statut (suspension, reprise, diplômé).', 'institution', 130),
    ('site_editor', 'Rédacteur du site public',
     'Rédige les textes du site de l’établissement ; la publication revient à l’administrateur.', 'institution', 140),
    ('communication_manager', 'Responsable des notifications',
     'Rédige et publie les modèles de messages, suit le journal des envois.', 'institution', 150)
ON CONFLICT (code) DO NOTHING;

INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES
    ('territory_manager', 'territory.read'), ('territory_manager', 'territory.write'), ('territory_manager', 'territory.define'), ('territory_manager', 'config.read'),
    ('config_manager', 'config.read'), ('config_manager', 'config.write'), ('config_manager', 'config.define'), ('config_manager', 'config.review'), ('config_manager', 'config.publish'),
    ('auditor', 'audit.read'), ('auditor', 'iam.read'), ('auditor', 'org.read'), ('auditor', 'catalog.read'), ('auditor', 'adm.read'), ('auditor', 'sis.read'),
    ('auditor', 'not.read'), ('auditor', 'territory.read'),
    ('institution_admin', 'iam.read'), ('institution_admin', 'iam.manage'), ('institution_admin', 'iam.assign'), ('institution_admin', 'iam.delegate'),
    ('institution_admin', 'iam.accounts'), ('institution_admin', 'audit.read'), ('institution_admin', 'territory.read'), ('institution_admin', 'config.read'),
    ('institution_admin', 'org.read'), ('institution_admin', 'org.write'), ('institution_admin', 'org.approve'),
    ('institution_admin', 'catalog.read'), ('institution_admin', 'catalog.write'), ('institution_admin', 'catalog.review'), ('institution_admin', 'catalog.publish'),
    ('institution_admin', 'catalog.authorize'), ('institution_admin', 'catalog.define'),
    ('institution_admin', 'lms.read'), ('institution_admin', 'lms.write'), ('institution_admin', 'lms.review'), ('institution_admin', 'lms.manage'),
    ('institution_admin', 'site.read'), ('institution_admin', 'site.write'), ('institution_admin', 'site.publish'),
    ('institution_admin', 'adm.read'), ('institution_admin', 'adm.manage'), ('institution_admin', 'adm.review'), ('institution_admin', 'adm.decide'),
    ('institution_admin', 'adm.appeal'),
    ('institution_admin', 'sis.read'), ('institution_admin', 'sis.manage'), ('institution_admin', 'sis.enrol'), ('institution_admin', 'sis.validate'), ('institution_admin', 'sis.status'),
    ('institution_admin', 'not.read'), ('institution_admin', 'not.manage'), ('institution_admin', 'not.publish'),
    ('academic_manager', 'org.read'), ('academic_manager', 'org.write'), ('academic_manager', 'org.approve'), ('academic_manager', 'catalog.read'),
    ('academic_manager', 'catalog.write'), ('academic_manager', 'catalog.review'), ('academic_manager', 'catalog.publish'), ('academic_manager', 'catalog.define'),
    ('academic_manager', 'lms.read'),
    ('program_manager', 'org.read'), ('program_manager', 'catalog.read'), ('program_manager', 'catalog.write'), ('program_manager', 'lms.read'),
    ('program_manager', 'lms.write'), ('program_manager', 'lms.manage'), ('program_manager', 'adm.read'), ('program_manager', 'sis.read'),
    ('teacher', 'lms.read'), ('teacher', 'lms.write'), ('teacher', 'catalog.read'),
    ('pedagogical_reviewer', 'lms.read'), ('pedagogical_reviewer', 'lms.review'), ('pedagogical_reviewer', 'catalog.read'), ('pedagogical_reviewer', 'catalog.review'),
    ('admissions_officer', 'adm.read'), ('admissions_officer', 'adm.manage'), ('admissions_officer', 'adm.review'), ('admissions_officer', 'catalog.read'),
    ('admissions_jury', 'adm.read'), ('admissions_jury', 'adm.decide'),
    ('appeals_committee', 'adm.read'), ('appeals_committee', 'adm.appeal'),
    ('registrar', 'sis.read'), ('registrar', 'sis.manage'), ('registrar', 'sis.enrol'), ('registrar', 'adm.read'), ('registrar', 'catalog.read'),
    ('registrar_validator', 'sis.read'), ('registrar_validator', 'sis.validate'), ('registrar_validator', 'sis.status'),
    ('site_editor', 'site.read'), ('site_editor', 'site.write'),
    ('communication_manager', 'not.read'), ('communication_manager', 'not.manage'), ('communication_manager', 'not.publish')
) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.permission WHERE code = item.permission)
ON CONFLICT DO NOTHING;

-- A platform-level role is granted on the platform root only.
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
    IF EXISTS (SELECT 1 FROM unoa.access_role WHERE code = role AND level = 'platform') AND target_scope <> unoa.iam_root() THEN
        RAISE EXCEPTION 'A platform role is granted on the platform' USING ERRCODE = '23514';
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

-- Invitation accepted by creating a local identifier and password
-- (no institutional provider yet, ADR-0010). The invitation's grant follows.
CREATE FUNCTION unoa.accept_invitation_local(token bytea, new_login text, new_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    holder uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM unoa.local_credential WHERE login = new_login) OR EXISTS (
        SELECT 1 FROM unoa.login_identity WHERE issuer = 'local' AND subject = new_login) THEN
        RAISE EXCEPTION 'This identifier is taken' USING ERRCODE = 'U0409';
    END IF;
    holder := unoa.accept_invitation(token, 'local', new_login);
    IF holder IS NULL THEN
        RETURN NULL;
    END IF;
    INSERT INTO unoa.local_credential(account_id, login, password_hash, must_change) VALUES (holder, new_login, new_hash, false);
    RETURN holder;
END;
$$;

REVOKE EXECUTE ON FUNCTION unoa.accept_invitation_local(bytea, text, text) FROM PUBLIC;
