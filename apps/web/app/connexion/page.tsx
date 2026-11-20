import type { Metadata } from 'next';
import { iamSettings } from '@/lib/iam/settings';

export const metadata: Metadata = { title: 'Connexion' };
export const dynamic = 'force-dynamic';

type Search = { statut?: string | string[] };

export default async function Connexion({ searchParams }: { searchParams: Promise<Search> }) {
  const { statut } = await searchParams;
  const settings = iamSettings();
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <h1>Connexion</h1>
        {statut === 'deconnecte' && <p role="status">Vous êtes déconnecté.</p>}
        {statut === 'refuse' && <p role="status">Connexion refusée. Vérifiez votre compte institutionnel et réessayez.</p>}
        {statut === 'indisponible' && <p role="status">Service temporairement indisponible. Réessayez dans quelques instants.</p>}
        {settings ? (
          <form action="/api/v1/auth/login" method="post">
            <button className="action" type="submit">Se connecter avec son compte institutionnel</button>
          </form>
        ) : (
          <p>L’accès aux comptes sera ouvert après l’activation de la connexion institutionnelle.</p>
        )}
      </section>
    </main>
  );
}
