import type { Metadata } from 'next';
import { iamSettings } from '@/lib/iam/settings';
import { developmentMode } from '@/lib/iam/local';

export const metadata: Metadata = { title: 'Connexion' };
export const dynamic = 'force-dynamic';

type Search = { statut?: string | string[] };
const messages: Record<string, string> = {
  deconnecte: 'Vous êtes déconnecté.',
  expire: 'Ce compte n’est plus connecté. Connectez-vous à nouveau.',
  refuse: 'Connexion refusée. Vérifiez votre identifiant et votre mot de passe.',
  code: 'Code de vérification incorrect ou expiré. Saisissez le code affiché par votre application d’authentification.',
  verrouille: 'Trop d’essais : le compte est verrouillé pendant 15 minutes.',
  indisponible: 'Service temporairement indisponible. Réessayez dans quelques instants.',
};

export default async function Connexion({ searchParams }: { searchParams: Promise<Search> }) {
  const { statut } = await searchParams;
  const settings = iamSettings();
  const message = typeof statut === 'string' ? messages[statut] : undefined;
  const development = settings ? await developmentMode(settings).catch(() => false) : false;
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <h1>Connexion</h1>
        {development && <p className="studio-notice" role="note">Mode développement : sécurité allégée (mot de passe libre, pas de blocage). À désactiver avant l’ouverture.</p>}
        {message && <p role={statut === 'deconnecte' ? 'status' : 'alert'} className="studio-notice">{message}</p>}
        {!settings ? <p>L’accès aux comptes sera ouvert après la mise en service de la base.</p> : (
          <>
            <form action="/api/v1/auth/local" method="post" className="studio-form">
              <label className="studio-wide">Identifiant<input name="login" required autoComplete="username" maxLength={120} /></label>
              <label className="studio-wide">Mot de passe<input name="password" type="password" required autoComplete="current-password" maxLength={200} /></label>
              <label className="studio-wide">Code de vérification (comptes d’administration)
                <input name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" maxLength={7} aria-describedby="code-aide" />
              </label>
              <p id="code-aide" className="studio-wide studio-help">Code à 6 chiffres de votre application d’authentification ; laisser vide si votre compte n’en a pas.</p>
              <div className="studio-wide"><button className="action" type="submit">Se connecter</button></div>
            </form>
            <p>Pas encore de compte ? <a href="/inscription">Créer un compte candidat</a></p>
            {settings.oidc && (
              <form action="/api/v1/auth/login" method="post">
                <button className="secondary" type="submit">Se connecter avec son compte institutionnel</button>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}
