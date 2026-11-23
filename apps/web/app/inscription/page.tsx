import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Créer un compte' };
export const dynamic = 'force-dynamic';

const errors: Record<string, string> = {
  '400': 'Vérifiez l’identifiant (lettres minuscules, chiffres, . _ @ -), le nom, le courriel et le mot de passe (12 caractères au moins, majuscules, minuscules et chiffres).',
  '403': 'La création de compte n’est pas ouverte sur ce site. Contactez l’établissement.',
  '409': 'Cet identifiant est déjà pris : choisissez-en un autre.', '422': 'Les deux mots de passe ne sont pas identiques.',
  '503': 'Service momentanément indisponible. Réessayez.',
};

export default async function Inscription({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const { erreur } = await searchParams;
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <h1>Créer un compte</h1>
        <p>Pour candidater à une formation et suivre vos démarches. Votre compte ne donne aucun droit d’administration.</p>
        {erreur && errors[erreur] && <p className="studio-notice" role="alert">{errors[erreur]}</p>}
        <form action="/api/v1/auth/register" method="post" className="studio-form">
          <label className="studio-wide">Nom et prénoms<input name="displayName" required maxLength={200} autoComplete="name" /></label>
          <label className="studio-wide">Courriel (facultatif)<input name="email" type="email" maxLength={254} autoComplete="email" /></label>
          <label className="studio-wide">Identifiant de connexion<input name="login" required minLength={3} maxLength={120} pattern="[a-z0-9][a-z0-9._@-]{2,119}" autoComplete="username" /></label>
          <label>Mot de passe<input name="password" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
          <label>Confirmation<input name="confirm" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
          <p className="studio-wide studio-help">12 caractères au moins, avec majuscules, minuscules et chiffres.</p>
          <div className="studio-wide"><button className="action" type="submit">Créer mon compte</button></div>
        </form>
        <p>Déjà inscrit ? <a href="/connexion">Se connecter</a></p>
      </section>
    </main>
  );
}
