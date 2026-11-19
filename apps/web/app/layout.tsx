import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = {
  title: 'UNOA · Campus numérique',
  description: 'Université numérique ouest-africaine',
  robots: { index: false, follow: false },
};

export default function Layout({children}: {children: ReactNode}) {
  return <html lang="fr"><body><a className="skip" href="#contenu">Aller au contenu</a>
    <header><a className="brand" href="/" aria-label="UNOA, accueil du campus">UNOA</a>
      <nav aria-label="Navigation du campus"><a href="/">Accueil</a><a href="/#formations">Formations</a><a href="/espace">Mon espace</a></nav>
    </header>{children}</body></html>;
}
