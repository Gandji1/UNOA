import 'server-only';
import type { IamSettings } from './settings';
import { database } from './sessions';

// Setup path and "who does what": the order in which a platform is configured,
// the studio for each step and the role template that performs it.

export type Level = 'platform' | 'territory' | 'institution' | 'unit';
export const levelLabels: Record<Level, string> = { platform: 'Plateforme', territory: 'Pays', institution: 'Établissement', unit: 'Faculté / département' };
export interface SetupStep { key: string; title: string; detail: string; href: string; roles: string[]; level: Level }

// Owner's hierarchy: super-administrator → country administrator →
// institution (campus) administrator → dean / head of department → teachers.
export const setupSteps: SetupStep[] = [
  { key: 'countries', title: '1. Pays', href: '/administration/territoires', level: 'platform',
    detail: 'Le super-administrateur déclare les types (pays, région, établissement, campus, faculté, département…) puis crée les pays.',
    roles: ['platform_admin', 'territory_manager'] },
  { key: 'country_admins', title: '2. Administrateurs pays', href: '/administration/acces', level: 'platform',
    detail: 'Inviter, pour chaque pays, son administrateur : rôle « Administrateur pays » sur ce pays.', roles: ['platform_admin'] },
  { key: 'territories', title: '3. Établissements universitaires et campus', href: '/administration/territoires', level: 'territory',
    detail: 'L’administrateur pays crée les universités et instituts de son pays, et leurs campus ; il nomme l’administrateur de chacun.',
    roles: ['country_admin'] },
  { key: 'site', title: '4. Site public de l’établissement', href: '/administration/site', level: 'institution',
    detail: 'Créer le site, son adresse, ses textes, puis le mettre en ligne.', roles: ['institution_admin', 'site_editor'] },
  { key: 'units', title: '5. Facultés puis départements', href: '/administration/structures', level: 'institution',
    detail: 'Créer les facultés, puis les départements au sein de chaque faculté ; nommer doyens et chefs de département.',
    roles: ['institution_admin', 'dean'] },
  { key: 'catalogue', title: '6. Filières, formations et matières', href: '/administration/catalogue', level: 'unit',
    detail: 'Dans chaque département : filières et spécialités, formations et leur maquette (semestres, UE, crédits), matières (cours) ; puis publication.',
    roles: ['department_head', 'dean', 'academic_manager', 'program_manager'] },
  { key: 'courses', title: '7. Cours, contenus et séances en direct', href: '/administration/cours', level: 'unit',
    detail: 'L’enseignant rédige leçons, vidéos et exercices, les fait valider, ouvre le cours à sa promotion et anime les séances en visioconférence avec les étudiants.',
    roles: ['teacher', 'department_head', 'pedagogical_reviewer'] },
  { key: 'admissions', title: '8. Admissions', href: '/administration/admissions', level: 'institution',
    detail: 'Ouvrir une campagne par formation publiée ; instruire, décider, traiter les recours.', roles: ['admissions_officer', 'admissions_jury', 'appeals_committee'] },
  { key: 'students', title: '9. Scolarité', href: '/administration/scolarite', level: 'institution',
    detail: 'Matricule, cohortes, inscription des admis, validation, statuts.', roles: ['registrar', 'registrar_validator'] },
];

export async function setupProgress(settings: IamSettings) {
  const { rows } = await database(settings).query<Record<string, number>>(`
    SELECT
      (SELECT count(*)::int FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code WHERE kind.nature = 'territory') AS countries,
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
