'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { NavGroup } from '@/lib/iam/navigation';

// Icon paths from the reference prototype (Lucide, ISC licence, see prototype/LICENSE-lucide.txt).
const icons: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  cap: 'M21.42 10.92a1 1 0 0 0 0-1.84L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.83l8.57 3.91a2 2 0 0 0 1.66 0zM22 10v6M6 12.5V16a6 3 0 0 0 12 0v-3.5',
  landmark: 'M10 18v-7M14 18v-7M18 18v-7M6 18v-7M3 22h18M11.12 2.2a2 2 0 0 1 1.76 0l7.87 3.85c.47.23.31.95-.22.95H3.47c-.53 0-.69-.72-.22-.95z',
  book: 'M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
  studio: 'M2 3h20M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3M7 21l5-5 5 5',
  play: 'M5 5a2 2 0 0 1 3-1.73l12 7a2 2 0 0 1 0 3.46l-12 7A2 2 0 0 1 5 19z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  map: 'M9 3 3 6v15l6-3 6 3 6-3V3l-6 3zM9 3v15M15 6v15',
  sliders: 'M10 5H3M12 19H3M14 3v4M16 17v4M21 12h-9M21 19h-5M21 5h-7M8 10v4M8 12H3',
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11',
  file: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4M10 13h4M10 17h4',
  key: 'M2.59 17.41A2 2 0 0 0 2 18.83V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.17a2 2 0 0 0 1.42-.59l.81-.81a6.5 6.5 0 1 0-4.84-4.84zM16.5 7.5h.01',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  bell: 'M10.27 21a2 2 0 0 0 3.46 0M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33',
  menu: 'M4 5h16M4 12h16M4 19h16',
  close: 'M18 6 6 18M6 6l12 12',
  moon: 'M20.99 12.49a9 9 0 1 1-9.48-9.48c.41-.02.62.46.4.8a6 6 0 0 0 8.27 8.27c.35-.21.83 0 .8.4',
  wifi: 'M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.43a5 5 0 0 1 7 0',
};

export function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round"><path d={icons[name] ?? icons.home} /></svg>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="mark">
      <rect x="4" y="4" width="56" height="56" rx="16" fill="#0B469C" />
      <path d="M50 33C50 43.5 41.5 52 31 52C22.8 52 15.8 46.7 13.4 39.2" stroke="#F97316" strokeWidth="2.8" strokeLinecap="round" fill="none" />
      <path d="M18 27.5C22.5 25.6 27.5 26.4 32 29.4C36.5 26.4 41.5 25.6 46 27.5V41.5C41.5 39.6 36.5 40.4 32 43.4C27.5 40.4 22.5 39.6 18 41.5V27.5Z" fill="white" />
      <path d="M32 29.4V43.4" stroke="#0B469C" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="32" cy="17.5" r="3.4" fill="#F97316" />
    </svg>
  );
}

const isActive = (path: string, href: string) => href.includes('?') ? false : href === '/' ? path === '/' : path === href || path.startsWith(href + '/');

// Reader preferences stay on this device only.
function usePreference(name: 'dark' | 'eco') {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try { setOn(localStorage.getItem('unoa.' + name) === '1'); } catch { /* storage unavailable */ }
  }, [name]);
  useEffect(() => {
    document.documentElement.classList.toggle(name, on);
    try { localStorage.setItem('unoa.' + name, on ? '1' : '0'); } catch { /* storage unavailable */ }
  }, [name, on]);
  return [on, setOn] as const;
}

export function Shell({ groups, brand, title, children, signedIn = false, accounts = [] }: { groups: NavGroup[]; brand: string | null; title: string; children: ReactNode; signedIn?: boolean; accounts?: { index: number; name: string; login: string | null; current: boolean }[] }) {
  const path = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [dark, setDark] = usePreference('dark');
  const [eco, setEco] = usePreference('eco');
  useEffect(() => setOpen(false), [path]);
  const all = groups.flatMap(group => group.items);
  const current = [...all].sort((a, b) => b.href.length - a.href.length).find(item => isActive(path, item.href));
  return (
    <div className={'campus' + (open ? ' nav-open' : '')}>
      <aside className="sidebar" aria-label="Espaces du campus">
        <div className="sidebar-head">
          <a href="/" className="sidebar-brand" aria-label={(brand ?? title) + ', accueil'}>
            <Mark />
            <span><strong>{brand ?? 'Campus'}</strong><small>{brand ? title : 'Site non configuré'}</small></span>
          </a>
          <button type="button" className="icon-button only-mobile" onClick={() => setOpen(false)} aria-label="Fermer le menu"><Icon name="close" /></button>
        </div>
        <nav className="sidebar-nav" aria-label="Navigation principale">
          {groups.map(group => {
            const here = group.items.includes(current!) || (path === '/administration/creer' && group.label === 'Créer');
            return (
              <details key={group.label} className="sidebar-group" open={here || groups.length <= 3 || undefined}>
                <summary className="sidebar-caption">{group.label}</summary>
                {group.items.map(item => (
                  <a key={item.href} href={item.href} className={item === current ? 'nav-item active' : 'nav-item'}
                    aria-current={item === current ? 'page' : undefined}><Icon name={item.icon} />{item.label}</a>
                ))}
              </details>
            );
          })}
        </nav>
      </aside>
      <div className="overlay only-mobile" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="workspace">
        <header className="topbar">
          <div className="head-line">
            <div className="head-left">
              <button type="button" className="icon-button only-mobile" onClick={() => setOpen(true)} aria-label="Menu des espaces" aria-expanded={open}><Icon name="menu" /></button>
              <span className="head-badge">{brand ?? 'CAMPUS'}</span>
              <span className="head-title">{current?.label ?? ''}</span>
            </div>
            <div className="head-tools">
              <button type="button" className={'tool' + (eco ? ' on' : '')} onClick={() => setEco(!eco)} aria-pressed={eco}
                title="Mode faible débit : sans illustrations ni animations"><Icon name="wifi" /><span>{eco ? 'Éco' : 'Débit normal'}</span></button>
              {signedIn
                ? (
                  <details className="account-menu">
                    <summary className="tool account-button"><Icon name="user" /><span>{accounts.find(item => item.current)?.name ?? 'Mon compte'}</span></summary>
                    <div className="account-list" role="menu">
                      {accounts.filter(item => !item.current).map(item => (
                        <form key={item.index} action="/api/v1/auth/switch" method="post">
                          <input type="hidden" name="compte" value={item.index} />
                          <button type="submit" role="menuitem">{item.name}{item.login && <small>{item.login}</small>}</button>
                        </form>
                      ))}
                      <a href="/connexion" role="menuitem">Ajouter un compte</a>
                      <form action="/api/v1/auth/logout" method="post"><button type="submit" role="menuitem">Se déconnecter</button></form>
                    </div>
                  </details>
                )
                : <a href="/connexion" className="tool account-button"><Icon name="user" /><span>Se connecter</span></a>}
              <button type="button" className={'tool' + (dark ? ' on' : '')} onClick={() => setDark(!dark)} aria-pressed={dark} title="Mode sombre"><Icon name="moon" /><span className="sr">Mode sombre</span></button>
            </div>
          </div>
          <nav className="role-strip" aria-label="Accès rapides">
            {(groups.find(group => current && group.items.includes(current))?.items ?? groups[0]?.items ?? []).map(item => (
              <a key={item.href} href={item.href} className={item === current ? 'pill active' : 'pill'}><Icon name={item.icon} />{item.label}</a>
            ))}
          </nav>
        </header>
        {children}
      </div>
    </div>
  );
}
