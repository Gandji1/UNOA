import type { Metadata } from 'next';
import { iamSettings } from '@/lib/iam/settings';
import { invitationPreview } from '@/lib/iam/admin';
import { formatTime } from '../../administration/forms';

export const metadata: Metadata = { title: 'Invitation', robots: { index: false } };
export const dynamic = 'force-dynamic';

const states: Record<string, string> = {
  accepted: 'Cette invitation a déjà été acceptée : connectez-vous avec votre identifiant.', revoked: 'Cette invitation a été retirée.', expired: 'Cette invitation a expiré.',
};
const errors: Record<string, string> = {
  '400': 'Vérifiez l’identifiant (lettres minuscules, chiffres, . _ @ -) et le mot de passe (12 caractères au moins, majuscules, minuscules et chiffres).',
  '409': 'Cet identifiant est déjà pris : choisissez-en un autre.', '410': 'Invitation expirée, retirée ou déjà utilisée.',
  '422': 'Les deux mots de passe ne sont pas identiques.', '503': 'Service momentanément indisponible. Réessayez.',
};

export default async function Invitation({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ erreur?: string }> }) {
  const { token } = await params;
  const { erreur } = await searchParams;
  const settings = iamSettings();
  const preview = settings ? await invitationPreview(settings, token).catch(() => null) : null;
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <h1>Invitation</h1>
        {!preview ? <p>Lien d’invitation invalide.</p> : preview.state !== 'pending' ? <p>{states[preview.state]} <a href="/connexion">Connexion</a></p> : (
          <>
            <p>Bonjour {preview.display_name}, vous êtes invité(e) à rejoindre <strong>{preview.scope_label}</strong> avec le rôle
              {' '}<strong>{preview.role_label}</strong>.</p>
            <p className="muted">Invitation valable jusqu’au {formatTime(preview.expires_at)}.</p>
            {erreur && errors[erreur] && <p className="studio-notice" role="alert">{errors[erreur]}</p>}
            <h2>Créer votre accès</h2>
            <form action="/api/v1/auth/invitation" method="post" className="studio-form">
              <input type="hidden" name="invitation" value={token} />
              <label className="studio-wide">Identifiant de connexion<input name="login" required minLength={3} maxLength={120} pattern="[a-z0-9][a-z0-9._@-]{2,119}" autoComplete="username" /></label>
              <label>Mot de passe<input name="password" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
              <label>Confirmation<input name="confirm" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
              <p className="studio-wide studio-help">12 caractères au moins, avec majuscules, minuscules et chiffres.</p>
              <div className="studio-wide"><button className="action" type="submit">Accepter l’invitation</button></div>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
