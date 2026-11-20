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
  ['iam.read', { href: '/administration/acces', label: 'Accès et rôles', icon: 'key' }],
  ['org.read', { href: '/administration/structures', label: 'Structures académiques', icon: 'landmark' }],
  ['catalog.read', { href: '/administration/catalogue', label: 'Catalogue des formations', icon: 'book' }],
  ['lms.read', { href: '/administration/cours', label: 'Studio des cours', icon: 'studio' }],
  ['adm.read', { href: '/administration/admissions', label: 'Admissions', icon: 'inbox' }],
  ['site.read', { href: '/administration/site', label: 'Site public', icon: 'globe' }],
  ['territory.read', { href: '/administration/territoires', label: 'Territoires', icon: 'map' }],
  ['config.read', { href: '/administration/parametres', label: 'Paramètres', icon: 'sliders' }],
];

// Short description of each studio, shown on the administration overview.
export const studioDescriptions: Record<string, string> = {
  '/administration/acces': 'Comptes, invitations, rôles composés, attributions, délégations, sessions et journal d’audit.',
  '/administration/structures': 'Facultés, départements, filières et autres unités ; postes, nominations et réorganisations.',
  '/administration/catalogue': 'Programmes, versions, maquettes, cours, prérequis, compétences et autorisations.',
  '/administration/cours': 'Contenus pédagogiques versionnés, offres de cours, promotions et classes virtuelles.',
  '/administration/admissions': 'Campagnes, formulaires et grilles, instruction des dossiers, décisions et recours.',
  '/administration/site': 'Site public de l’établissement : noms d’hôte, textes, mise en ligne, création de compte.',
  '/administration/territoires': 'Territoires, juridictions, établissements, centres et rattachements.',
  '/administration/parametres': 'Paramètres typés, héritage par portée, versions et dates d’effet.',
};

export const navigation = cache(async () => {
  const groups: NavGroup[] = [{
    label: 'Portail public',
    items: [
      { href: '/', label: 'Accueil', icon: 'home' },
      { href: '/formations', label: 'Formations', icon: 'cap' },
      { href: '/structures', label: 'Structures', icon: 'landmark' },
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
      groups.push({ label: 'Apprentissage', items: [
        { href: '/apprendre', label: 'Mes cours et séances', icon: 'play' },
        { href: '/candidature', label: 'Mes candidatures', icon: 'file' },
      ] });
      const admin = administration.filter(([permission]) => held.has(permission)).map(([, item]) => item);
      if (admin.length) groups.push({ label: 'Administration', items: [{ href: '/administration', label: 'Vue d’ensemble', icon: 'grid' }, ...admin] });
    }
  }
  groups.push({ label: 'Compte', items: [signedIn
    ? { href: '/espace', label: 'Mon espace', icon: 'user' }
    : { href: '/connexion', label: 'Connexion', icon: 'user' }] });
  return { groups, signedIn };
});
