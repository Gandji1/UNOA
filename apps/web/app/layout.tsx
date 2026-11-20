import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = {
  title: 'UNOA · Campus numérique',
  description: 'Université numérique ouest-africaine',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#072f6b', width: 'device-width', initialScale: 1 };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <a className="skip" href="#contenu">Aller au contenu</a>
        <header className="topbar">
          <a className="brand" href="/" aria-label="UNOA, accueil du campus"><span aria-hidden="true">U</span>UNOA</a>
          <nav aria-label="Navigation du campus">
            <a href="/">Accueil</a>
            <a href="/formations">Formations</a>
            <a href="/structures">Structures</a>
            <a href="/apprendre">Mes cours</a>
            <a href="/espace" className="nav-account">Mon espace</a>
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <p>Université numérique ouest-africaine · campus numérique</p>
          <p>Les informations publiées proviennent des référentiels de l’université ; aucune formation n’est présumée autorisée.</p>
        </footer>
      </body>
    </html>
  );
}
