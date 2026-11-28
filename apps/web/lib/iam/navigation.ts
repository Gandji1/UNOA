import 'server-only';
import { openAccounts, type OpenAccount } from './accounts';
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
  ['tea.read', { href: '/administration/enseignants', label: 'Enseignants', icon: 'user' }],
  ['grd.read', { href: '/administration/notes', label: 'Notes et jurys', icon: 'file' }],
  ['exn.read', { href: '/administration/examens-nationaux', label: 'Examens nationaux', icon: 'landmark' }],
  ['fin.read', { href: '/administration/finances', label: 'Finances', icon: 'sliders' }],
  ['cred.read', { href: '/administration/documents', label: 'Documents et diplômes', icon: 'file' }],
  ['short.read', { href: '/administration/formations-courtes', label: 'Formations courtes', icon: 'cap' }],
  ['thesis.read', { href: '/administration/memoires', label: 'Mémoires et soutenances', icon: 'book' }],
  ['phd.read', { href: '/administration/doctorat', label: 'Doctorat', icon: 'cap' }],
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
  '/administration/finances': 'Tarifs approuvés, factures et avoirs, échéances, remises et bourses, paiements confirmés par le prestataire, reçus, remboursements, rapprochement et exports.',
  '/administration/memoires': 'Règlement des soutenances, sujets, validation des projets, encadrement, contrôle d’intégrité, jurys, procès-verbaux et dépôts.',
  '/administration/doctorat': 'Écoles doctorales et laboratoires, admissions, comités de suivi, réinscriptions, formations doctorales et autorisation de soutenance.',
  '/administration/formations-courtes': 'Catalogue de formations courtes, modules et compétences, sessions, clients entreprises, progression, attestations, microcertifications, reconnaissance des acquis et rapports.',
  '/administration/documents': 'Types et modèles de documents, délivrance sous conditions et habilitation, signatures, registre, révocation et vérification par QR.',
  '/administration/examens-nationaux': 'Suivi documentaire des examens nationaux : information officielle, déclarations, pièces déposées et vérification.',
  '/administration/notes': 'Règles de notation versionnées, saisie et validation des notes, jurys, procès-verbaux signés, publication, crédits, contestations et rectifications.',
  '/administration/enseignants': 'Appels à candidatures, contrôle des pièces, expertises, recrutement, contrats, affectations et rémunérations.',
  '/administration/site': 'Site public de l’établissement : noms d’hôte, textes, mise en ligne, création de compte.',
  '/administration/territoires': 'Pays, régions, établissements universitaires et campus.',
  '/administration/parametres': 'Règles et réglages par pays ou établissement, avec versions et dates d’effet.',
};

// Creation shortcuts by level (owner's hierarchy): shown only where the
// person may create the object (same rule as the creation assistants).
const creations: { kind: string; label: string; check: string }[] = [
  { kind: 'pays', label: 'Un pays', check: "kind.nature = 'platform' AND unoa.may_create($1, 'territory.write', scope.id, 'territory')" },
  { kind: 'etablissement', label: 'Un établissement', check: "kind.nature IN ('territory', 'jurisdiction') AND unoa.may_create($1, 'territory.write', scope.id, 'institution')" },
  { kind: 'campus', label: 'Un campus', check: "kind.nature = 'institution' AND unoa.may_create($1, 'territory.write', scope.id, 'centre')" },
  { kind: 'faculte', label: 'Une faculté', check: "kind.nature IN ('institution', 'centre') AND unoa.may_create($1, 'org.write', scope.id, 'faculty')" },
  { kind: 'departement', label: 'Un département', check: "kind.nature = 'academic_unit' AND unoa.may_create($1, 'org.write', scope.id, 'department')" },
  { kind: 'filiere', label: 'Une filière', check: "kind.nature = 'academic_unit' AND unoa.may_create($1, 'catalog.write', scope.id, 'catalog')" },
  { kind: 'formation', label: 'Une formation', check: "kind.nature = 'academic_unit' AND unoa.may_create($1, 'catalog.write', scope.id, 'catalog')" },
  { kind: 'matiere', label: 'Une matière', check: "kind.nature = 'academic_unit' AND unoa.may_create($1, 'catalog.write', scope.id, 'catalog')" },
  { kind: 'responsable', label: 'Nommer une personne', check: "unoa.holds_here($1, 'iam.assign', scope.id)" },
];

// What each role creates in the hierarchy (a person holding several roles
// sees the union); custom roles fall back to their permissions.
const roleCreations: Record<string, string[]> = {
  platform_admin: ['pays', 'responsable'], territory_manager: ['pays', 'etablissement', 'campus'],
  country_admin: ['etablissement', 'responsable'],
  institution_admin: ['faculte', 'campus', 'responsable'], dean: ['departement', 'responsable'],
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
  // The naming entry says whom the person names next (head of the level below).
  const naming = ([['platform_admin', 'Nommer un administrateur pays'], ['country_admin', 'Nommer un recteur'], ['institution_admin', 'Nommer un doyen ou un collaborateur'],
    ['dean', 'Nommer un chef de département'], ['department_head', 'Nommer un enseignant']] as const).find(([code]) => roles.some(role => role.role_code === code))?.[1];
  return creations.filter(item => rows[0]?.[item.kind] && (custom || expected.has(item.kind)))
    .map(item => item.kind === 'responsable' && naming ? { ...item, label: naming } : item);
}

// Sidebar sections, each folded under its heading (TDR §19: menus follow permissions).
const sections: { label: string; icon: string; hrefs: string[] }[] = [
  { label: 'Organisation', icon: 'map', hrefs: ['/administration/territoires', '/administration/structures', '/administration/gouvernance', '/administration/site'] },
  { label: 'Formations et cours', icon: 'book', hrefs: ['/administration/catalogue', '/administration/cours', '/administration/enseignants', '/administration/formations-courtes', '/administration/memoires', '/administration/doctorat'] },
  { label: 'Étudiants', icon: 'cap', hrefs: ['/administration/admissions', '/administration/scolarite', '/administration/notes', '/administration/examens-nationaux', '/administration/documents', '/administration/finances'] },
  { label: 'Utilisateurs', icon: 'key', hrefs: ['/administration/acces'] },
  { label: 'Réglages', icon: 'sliders', hrefs: ['/administration/notifications', '/administration/parametres'] },
];

export const navigation = cache(async () => {
  const groups: NavGroup[] = [{
    label: 'Site public',
    items: [
      { href: '/', label: 'Accueil', icon: 'home' },
      { href: '/formations', label: 'Formations', icon: 'cap' },
      { href: '/formations-courtes', label: 'Formations courtes', icon: 'cap' },
      { href: '/structures', label: 'Structures', icon: 'landmark' },
      { href: '/decisions', label: 'Décisions', icon: 'file' },
      { href: '/examens-nationaux', label: 'Examens nationaux', icon: 'landmark' },
      { href: '/memoires', label: 'Mémoires publiés', icon: 'book' },
      { href: '/verifier', label: 'Vérifier un document', icon: 'key' },
    ],
  }];
  const settings = iamSettings();
  let signedIn = false;
  let accounts: OpenAccount[] = [];
  if (settings) {
    const jar = await cookies();
    const token = jar.get(cookieName(settings, 'session'))?.value;
    const actor = await sessionAccount(settings, token).catch(() => null);
    if (actor) accounts = await openAccounts(settings, jar.get(cookieName(settings, 'accounts'))?.value, token).catch(() => []);
    if (actor) {
      signedIn = true;
      const { rows } = await database(settings).query<{ permissions: string[] }>(
        'SELECT unoa.account_permissions($1) AS permissions', [actor],
      ).catch(() => ({ rows: [{ permissions: [] as string[] }] }));
      const held = new Set(rows[0]?.permissions ?? []);
      const spaces = new Set(await database(settings).query<{ spaces: string[] }>('SELECT unoa.account_spaces($1) AS spaces', [actor])
        .then(result => result.rows[0]?.spaces ?? []).catch(() => [] as string[]));
      const staff = held.size > 0;
      const personal: [boolean, NavItem][] = [
        [true, { href: '/espace', label: 'Mon espace', icon: 'user' }],
        [spaces.has('learning') || spaces.has('teaching'), { href: '/apprendre', label: spaces.has('teaching') && !spaces.has('learning') ? 'Mes cours et séances' : 'Mes cours', icon: 'play' }],
        [spaces.has('learning'), { href: '/evaluations', label: 'Mes évaluations', icon: 'file' }],
        [spaces.has('learning') || spaces.has('student'), { href: '/resultats', label: 'Mes résultats', icon: 'cap' }],
        [spaces.has('teaching') || (!staff && !spaces.has('learning')), { href: '/enseignement', label: spaces.has('teaching') ? 'Espace enseignant' : 'Devenir enseignant', icon: 'studio' }],
        [spaces.has('admission') || (!staff && !spaces.has('learning') && !spaces.has('teaching')), { href: '/candidature', label: 'Mes candidatures', icon: 'file' }],
        [spaces.has('student'), { href: '/etudiant', label: 'Mon dossier étudiant', icon: 'user' }],
        [spaces.has('finance'), { href: '/finances', label: 'Mes finances', icon: 'sliders' }],
        [spaces.has('documents'), { href: '/documents', label: 'Mes documents', icon: 'file' }],
        [spaces.has('short'), { href: '/formations-courtes/mes', label: 'Mes formations courtes', icon: 'cap' }],
        [spaces.has('external'), { href: '/examens-nationaux/suivi', label: 'Examens nationaux', icon: 'landmark' }],
        [spaces.has('thesis') || spaces.has('student'), { href: '/memoires/mes', label: 'Mon mémoire', icon: 'book' }],
        [spaces.has('doctorate') || spaces.has('student'), { href: '/doctorat', label: 'Mon doctorat', icon: 'cap' }],
        [spaces.has('councils'), { href: '/conseils', label: 'Mes conseils', icon: 'landmark' }],
      ];
      groups.push({ label: 'Mon espace', items: personal.filter(([shown]) => shown).map(([, item]) => item) });
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
  return { groups, signedIn, accounts };
});
