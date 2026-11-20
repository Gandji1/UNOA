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
  ['org.read', { href: '/administration/structures', label: 'Structures académiques', icon: 'landmark' }],
  ['catalog.read', { href: '/administration/catalogue', label: 'Catalogue des formations', icon: 'book' }],
  ['lms.read', { href: '/administration/cours', label: 'Studio des cours', icon: 'studio' }],
  ['site.read', { href: '/administration/site', label: 'Site public', icon: 'globe' }],
  ['territory.read', { href: '/administration/territoires', label: 'Territoires', icon: 'map' }],
  ['config.read', { href: '/administration/parametres', label: 'Paramètres', icon: 'sliders' }],
];

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
      groups.push({ label: 'Apprentissage', items: [{ href: '/apprendre', label: 'Mes cours et séances', icon: 'play' }] });
      const admin = administration.filter(([permission]) => held.has(permission)).map(([, item]) => item);
      if (admin.length) groups.push({ label: 'Administration', items: admin });
    }
  }
  groups.push({ label: 'Compte', items: [signedIn
    ? { href: '/espace', label: 'Mon espace', icon: 'user' }
    : { href: '/connexion', label: 'Connexion', icon: 'user' }] });
  return { groups, signedIn };
});
