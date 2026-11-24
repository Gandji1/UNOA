import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { cookieName, iamSettings } from './settings';
import { database, sessionAccount } from './sessions';

export interface NavItem { href: string; label: string; icon: string }
export interface NavGroup { label: string; items: NavItem[] }

// Menus follow the permissions held by the session; a hidden route stays
// protected on the server (TDR §18).
const administration: [string, NavItem][] = [
  ['iam.read', { href: '/administration/acces', label: 'Utilisateurs et rôles', icon: 'key' }],
  ['org.read', { href: '/administration/structures', label: 'Facultés et départements', icon: 'landmark' }],
  ['catalog.read', { href: '/administration/catalogue', label: 'Filières et formations', icon: 'book' }],
  ['lms.read', { href: '/administration/cours', label: 'Cours en ligne', icon: 'studio' }],
  ['adm.read', { href: '/administration/admissions', label: 'Admissions', icon: 'inbox' }],
  ['not.read', { href: '/administration/notifications', label: 'Notifications', icon: 'bell' }],
  ['sis.read', { href: '/administration/scolarite', label: 'Scolarité', icon: 'cap' }],
  ['gov.read', { href: '/administration/gouvernance', label: 'Conseils et décisions', icon: 'landmark' }],
  ['site.read', { href: '/administration/site', label: 'Site public', icon: 'globe' }],
  ['territory.read', { href: '/administration/territoires', label: 'Pays et établissements', icon: 'map' }],
  ['config.read', { href: '/administration/parametres', label: 'Réglages', icon: 'sliders' }],
];

// Short description of each studio, shown on the administration overview.
export const studioDescriptions: Record<string, string> = {
  '/administration/acces': 'Comptes, invitations, rôles composés, attributions, délégations, sessions et journal d’audit.',
  '/administration/structures': 'Facultés, départements, filières et autres unités ; postes, nominations et réorganisations.',
  '/administration/catalogue': 'Programmes, versions, maquettes, cours, prérequis, compétences et autorisations.',
  '/administration/cours': 'Contenus pédagogiques versionnés, offres de cours, promotions et classes virtuelles.',
  '/administration/admissions': 'Campagnes, formulaires et grilles, instruction des dossiers, décisions et recours.',
  '/administration/notifications': 'Modèles de messages par événement, canal et langue ; journal des envois, files et rejeu.',
  '/administration/scolarite': 'Matricules, cohortes et groupes, inscriptions administratives et pédagogiques, statuts et dossiers.',
  '/administration/gouvernance': 'Conseils, membres et mandats, séances, ordres du jour, quorum, votes, décisions, procès-verbaux signés et publication.',
  '/administration/site': 'Site public de l’établissement : noms d’hôte, textes, mise en ligne, création de compte.',
  '/administration/territoires': 'Pays, régions, établissements universitaires et campus.',
  '/administration/parametres': 'Règles et réglages par pays ou établissement, avec versions et dates d’effet.',
};

// Creation shortcuts by level (owner's hierarchy): shown only where the
// person may create the object (same rule as the creation assistants).
const creations: { kind: string; label: string; check: string }[] = [
  { kind: 'pays', label: 'Un pays', check: "unoa.has_scope_permission($1, 'territory.write', scope.id) AND kind.nature = 'platform'" },
  { kind: 'etablissement', label: 'Un établissement', check: "unoa.has_scope_permission($1, 'territory.write', scope.id) AND kind.nature IN ('territory', 'jurisdiction')" },
  { kind: 'campus', label: 'Un campus', check: "unoa.has_scope_permission($1, 'territory.write', scope.id) AND kind.nature = 'institution'" },
  { kind: 'faculte', label: 'Une faculté', check: "unoa.has_scope_permission($1, 'org.write', scope.id) AND kind.nature = 'institution'" },
  { kind: 'departement', label: 'Un département', check: "unoa.has_scope_permission($1, 'org.write', scope.id) AND kind.nature = 'academic_unit'" },
  { kind: 'filiere', label: 'Une filière', check: "unoa.has_scope_permission($1, 'catalog.write', scope.id) AND kind.nature IN ('institution', 'academic_unit')" },
  { kind: 'formation', label: 'Une formation', check: "unoa.has_scope_permission($1, 'catalog.write', scope.id) AND kind.nature IN ('institution', 'academic_unit')" },
  { kind: 'matiere', label: 'Une matière', check: "unoa.has_scope_permission($1, 'catalog.write', scope.id) AND kind.nature IN ('institution', 'academic_unit')" },
  { kind: 'responsable', label: 'Nommer un responsable', check: "unoa.has_scope_permission($1, 'iam.manage', scope.id)" },
];

// What each role creates in the hierarchy (a person holding several roles
// sees the union); custom roles fall back to their permissions.
const roleCreations: Record<string, string[]> = {
  platform_admin: ['pays', 'responsable'], territory_manager: ['pays', 'etablissement', 'campus'],
  country_admin: ['etablissement', 'campus', 'responsable'],
  institution_admin: ['faculte', 'departement', 'responsable'], dean: ['departement', 'responsable'],
  department_head: ['filiere', 'formation', 'matiere', 'responsable'], academic_manager: ['faculte', 'departement', 'filiere', 'formation', 'matiere'],
  program_manager: ['formation', 'matiere'],
};

export async function allowedCreations(actor: string) {
  const settings = iamSettings();
  if (!settings) return [];
  const store = database(settings);
  const [{ rows }, { rows: roles }] = await Promise.all([
    store.query<Record<string, boolean>>(`SELECT ${creations.map(item =>
      `EXISTS (SELECT 1 FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code WHERE ${item.check}) AS "${item.kind}"`).join(', ')}`, [actor]),
    store.query<{ role_code: string }>('SELECT DISTINCT role_code FROM unoa.iam_account($1, $1) WHERE revoked_at IS NULL AND (effective_until IS NULL OR effective_until > now())', [actor]),
  ]);
  const custom = roles.some(role => !(role.role_code in roleCreations));
  const expected = new Set(roles.flatMap(role => roleCreations[role.role_code] ?? []));
  return creations.filter(item => rows[0]?.[item.kind] && (custom || expected.has(item.kind)));
}

// Sidebar sections, each folded under its heading (TDR §19: menus follow permissions).
const sections: { label: string; icon: string; hrefs: string[] }[] = [
  { label: 'Organisation', icon: 'map', hrefs: ['/administration/territoires', '/administration/structures', '/administration/gouvernance', '/administration/site'] },
  { label: 'Formations et cours', icon: 'book', hrefs: ['/administration/catalogue', '/administration/cours'] },
  { label: 'Étudiants', icon: 'cap', hrefs: ['/administration/admissions', '/administration/scolarite'] },
  { label: 'Utilisateurs', icon: 'key', hrefs: ['/administration/acces'] },
  { label: 'Réglages', icon: 'sliders', hrefs: ['/administration/notifications', '/administration/parametres'] },
];

export const navigation = cache(async () => {
  const groups: NavGroup[] = [{
    label: 'Site public',
    items: [
      { href: '/', label: 'Accueil', icon: 'home' },
      { href: '/formations', label: 'Formations', icon: 'cap' },
      { href: '/structures', label: 'Structures', icon: 'landmark' },
      { href: '/decisions', label: 'Décisions', icon: 'file' },
    ],
  }];
  const settings = iamSettings();
  let signedIn = false;
  if (settings) {
    const actor = await sessionAccount(settings, (await cookies()).get(cookieName(settings, 'session'))?.value).catch(() => null);
    if (actor) {
      signedIn = true;
      const { rows } = await database(settings).query<{ permissions: string[] }>(
        'SELECT unoa.account_permissions($1) AS permissions', [actor],
      ).catch(() => ({ rows: [{ permissions: [] as string[] }] }));
      const held = new Set(rows[0]?.permissions ?? []);
      groups.push({ label: 'Mon espace', items: [
        { href: '/espace', label: 'Mon espace', icon: 'user' },
        { href: '/apprendre', label: 'Mes cours et séances', icon: 'play' },
        { href: '/candidature', label: 'Mes candidatures', icon: 'file' },
        { href: '/etudiant', label: 'Mon dossier étudiant', icon: 'user' },
        { href: '/conseils', label: 'Mes conseils', icon: 'landmark' },
      ] });
      const admin = administration.filter(([permission]) => held.has(permission)).map(([, item]) => item);
      if (admin.length) {
        groups.push({ label: 'Tableau de bord', items: [
          { href: '/administration', label: 'Vue d’ensemble', icon: 'grid' }, { href: '/administration/guide', label: 'Qui fait quoi', icon: 'book' }] });
        const create = await allowedCreations(actor).catch(() => []);
        if (create.length) groups.push({ label: 'Créer', items: create.map(item => ({ href: '/administration/creer?quoi=' + item.kind, label: item.label, icon: 'studio' })) });
        for (const section of sections) {
          const items = section.hrefs.map(href => admin.find(item => item.href === href)).filter((item): item is NavItem => !!item);
          if (items.length) groups.push({ label: section.label, items });
        }
      }
    }
  }
  if (!signedIn) groups.push({ label: 'Compte', items: [
    { href: '/connexion', label: 'Connexion', icon: 'user' }, { href: '/inscription', label: 'Créer un compte', icon: 'file' }] });
  return { groups, signedIn };
});
