import 'server-only';
import type { IamSettings } from './settings';
import { database } from './sessions';

// Setup path and "who does what": the order in which a platform is configured,
// the studio for each step and the role template that performs it.

export interface SetupStep { key: string; title: string; detail: string; href: string; roles: string[]; level: 'platform' | 'institution'; count?: number }

export const setupSteps: SetupStep[] = [
  { key: 'territories', title: 'Territoires, établissements et campus', href: '/administration/territoires', level: 'platform',
    detail: 'Déclarer les types (pays, région, établissement, campus…), puis créer les territoires, chaque établissement et ses centres ou campus.',
    roles: ['platform_admin', 'territory_manager'] },
  { key: 'admins', title: 'Administrateurs d’établissement', href: '/administration/acces', level: 'platform',
    detail: 'Inviter, pour chaque établissement, la personne qui l’administre : rôle « Administrateur d’établissement » sur cet établissement.',
    roles: ['platform_admin'] },
  { key: 'site', title: 'Site public de l’établissement', href: '/administration/site', level: 'institution',
    detail: 'Créer le site, son adresse, ses textes (accueil, mentions légales, confidentialité), puis le mettre en ligne.',
    roles: ['institution_admin', 'site_editor'] },
  { key: 'units', title: 'Facultés, écoles, départements, laboratoires', href: '/administration/structures', level: 'institution',
    detail: 'Créer les composantes de l’établissement, leurs responsables et postes ; les fusions et transferts sont tracés.',
    roles: ['institution_admin', 'academic_manager'] },
  { key: 'catalogue', title: 'Filières, spécialités, formations et matières', href: '/administration/catalogue', level: 'institution',
    detail: 'Déclarer domaines, filières, mentions, spécialités ; créer les formations, leur maquette (périodes, UE, crédits) et les matières (cours), puis publier.',
    roles: ['institution_admin', 'academic_manager', 'program_manager'] },
  { key: 'courses', title: 'Cours en ligne et visioconférences', href: '/administration/cours', level: 'institution',
    detail: 'Rédiger leçons, vidéos et exercices, faire valider, ouvrir une offre à une promotion, planifier les séances.',
    roles: ['teacher', 'program_manager', 'pedagogical_reviewer'] },
  { key: 'admissions', title: 'Campagnes d’admission', href: '/administration/admissions', level: 'institution',
    detail: 'Ouvrir une campagne par formation publiée : formulaire, pièces, grille ; instruire, décider, traiter les recours.',
    roles: ['admissions_officer', 'admissions_jury', 'appeals_committee'] },
  { key: 'students', title: 'Scolarité : matricules, cohortes, inscriptions', href: '/administration/scolarite', level: 'institution',
    detail: 'Régler le matricule, créer les cohortes, inscrire les admis, valider les inscriptions, suivre les statuts.',
    roles: ['registrar', 'registrar_validator'] },
  { key: 'notifications', title: 'Messages et notifications', href: '/administration/notifications', level: 'institution',
    detail: 'Adapter les messages envoyés (courriel, SMS, espace personnel) par événement et par langue.',
    roles: ['communication_manager', 'institution_admin'] },
];

export async function setupProgress(settings: IamSettings) {
  const { rows } = await database(settings).query<Record<string, number>>(`
    SELECT
      (SELECT count(*)::int FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code WHERE kind.nature = 'institution') AS territories,
      (SELECT count(*)::int FROM unoa.site WHERE online) AS site,
      (SELECT count(*)::int FROM unoa.org_unit) AS units,
      (SELECT count(*)::int FROM unoa.program_version WHERE state = 'published') AS catalogue,
      (SELECT count(*)::int FROM unoa.course_version WHERE state = 'published') AS courses,
      (SELECT count(*)::int FROM unoa.admission_round WHERE state = 'open') AS admissions,
      (SELECT count(*)::int FROM unoa.cohort) AS students
  `);
  return rows[0];
}

export async function roleGuide(settings: IamSettings) {
  const { rows } = await database(settings).query<{ code: string; label: string | null; description: string | null; level: string; permissions: string[] }>(`
    SELECT role.code, role.label, role.description, role.level,
      coalesce(array_agg(permission.label ORDER BY permission.module, permission.code) FILTER (WHERE permission.code IS NOT NULL), '{}') AS permissions
    FROM unoa.access_role AS role LEFT JOIN unoa.role_permission AS item ON item.role_code = role.code
    LEFT JOIN unoa.permission ON permission.code = item.permission_code
    WHERE role.archived_at IS NULL GROUP BY role.code ORDER BY role.ordinal, role.label
  `);
  return rows;
}
