import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { currentSite } from '@/lib/site/store';
import { navigation } from '@/lib/iam/navigation';
import { Shell } from './shell';
import './styles.css';

// Brand, titles and footer come from the public site of the requested host.
// Without a configured site, the chrome stays neutral.
export async function generateMetadata(): Promise<Metadata> {
  const site = await currentSite();
  return {
    title: site ? { template: '%s · ' + site.short_name, default: site.name } : { template: '%s', default: 'Site non configuré' },
    description: site?.tagline ?? undefined,
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = { themeColor: '#072f6b', width: 'device-width', initialScale: 1 };

export default async function Layout({ children }: { children: ReactNode }) {
  const [site, nav] = await Promise.all([currentSite(), navigation()]);
  return (
    <html lang={site?.language ?? 'fr'}>
      <body>
        <a className="skip" href="#contenu">Aller au contenu</a>
        <Shell signedIn={nav.signedIn} groups={nav.groups} brand={site?.short_name ?? null} title={site?.name ?? ''}>
          {children}
          <footer className="site-footer">
            {site && <p>{site.footer ?? site.name}</p>}
            {site?.contact && <p className="footer-contact">{site.contact}</p>}
            <p className="footer-links">
              {site?.legal_notice && <a href="/mentions-legales">Mentions légales</a>}
              {site?.privacy_notice && <a href="/confidentialite">Confidentialité</a>}
              {site?.about && <a href="/a-propos">À propos</a>}
            </p>
          </footer>
        </Shell>
      </body>
    </html>
  );
}
