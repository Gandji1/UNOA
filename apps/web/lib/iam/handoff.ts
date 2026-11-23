import 'server-only';
import type { IamSettings } from './settings';
import { database } from './sessions';

// Hand-over messages along the hierarchy: what the people one level below must
// do once they sign in, and what the signed-in person is expected to do.

export const roleTasks: Record<string, string> = {
  platform_admin: 'créer les pays et nommer leurs administrateurs',
  country_admin: 'créer les établissements universitaires et les campus du pays, puis nommer leurs administrateurs',
  institution_admin: 'créer les facultés puis les départements, préparer le site public, puis nommer doyens et chefs de département',
  dean: 'créer les départements de la faculté, valider les formations et nommer les chefs de département',
  department_head: 'créer les filières, formations et matières du département, puis nommer les enseignants',
  teacher: 'créer ses cours en ligne (leçons, vidéos, exercices) et planifier les séances en direct',
  academic_manager: 'créer facultés, départements, filières et formations, et les publier',
  program_manager: 'compléter la maquette de la formation et ouvrir les cours',
  pedagogical_reviewer: 'relire et valider les cours et formations',
  admissions_officer: 'ouvrir les campagnes de candidature et instruire les dossiers',
  admissions_jury: 'rendre les décisions d’admission',
  appeals_committee: 'statuer sur les recours',
  registrar: 'régler le matricule, créer les cohortes et inscrire les admis',
  registrar_validator: 'valider les inscriptions',
  site_editor: 'rédiger les textes du site public',
  communication_manager: 'adapter les messages envoyés',
};

export interface Handoff { name: string; role: string; roleCode: string; scope: string; state: 'pending' | 'accepted' | 'expired' | 'revoked'; task: string }

export async function handoffs(settings: IamSettings, actor: string): Promise<Handoff[]> {
  const { rows } = await database(settings).query<{ display_name: string; role_code: string; role_label: string | null; scope_label: string;
    accepted_at: Date | null; revoked_at: Date | null; expires_at: Date }>(`
    SELECT invitation.display_name, invitation.role_code, role.label AS role_label, scope.label AS scope_label,
      invitation.accepted_at, invitation.revoked_at, invitation.expires_at
    FROM unoa.invitation JOIN unoa.access_role AS role ON role.code = invitation.role_code JOIN unoa.scope ON scope.id = invitation.scope_id
    WHERE invitation.invited_by = $1 ORDER BY invitation.created_at DESC LIMIT 20
  `, [actor]);
  return rows.map(row => ({
    name: row.display_name, role: row.role_label ?? row.role_code, roleCode: row.role_code, scope: row.scope_label,
    state: row.accepted_at ? 'accepted' : row.revoked_at ? 'revoked' : new Date(row.expires_at) < new Date() ? 'expired' : 'pending',
    task: roleTasks[row.role_code] ?? 'réaliser les actions de son rôle',
  }));
}

export async function myTasks(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ role_code: string; role_label: string | null; scope_label: string }>(
    'SELECT role_code, role_label, scope_label FROM unoa.iam_account($1, $1) WHERE revoked_at IS NULL AND (effective_until IS NULL OR effective_until > now())', [actor]);
  return rows.map(row => ({ role: row.role_label ?? row.role_code, scope: row.scope_label, task: roleTasks[row.role_code] }))
    .filter(item => item.task);
}
