import type { Metadata } from 'next';
import { iamSettings } from '@/lib/iam/settings';
import { invitationPreview } from '@/lib/iam/admin';
import { formatTime } from '../../administration/forms';

export const metadata: Metadata = { title: 'Invitation', robots: { index: false } };
export const dynamic = 'force-dynamic';

const states: Record<string, string> = {
  accepted: 'Cette invitation a déjà été acceptée.', revoked: 'Cette invitation a été retirée.', expired: 'Cette invitation a expiré.',
};

export default async function Invitation({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const settings = iamSettings();
  const preview = settings ? await invitationPreview(settings, token).catch(() => null) : null;
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <h1>Invitation</h1>
        {!preview ? <p>Lien d’invitation invalide.</p> : preview.state !== 'pending' ? <p>{states[preview.state]}</p> : (
          <>
            <p>Bonjour {preview.display_name}, vous êtes invité(e) à rejoindre <strong>{preview.scope_label}</strong> avec le rôle
              {' '}<strong>{preview.role_label}</strong>.</p>
            <p className="muted">Invitation valable jusqu’au {formatTime(preview.expires_at)}. Connectez-vous avec votre compte institutionnel pour l’accepter.</p>
            <form action="/api/v1/auth/login" method="post">
              <input type="hidden" name="invitation" value={token} />
              <button className="action" type="submit">Accepter et se connecter</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
