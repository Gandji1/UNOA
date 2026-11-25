import type { Metadata } from 'next';
import { iamSettings } from '@/lib/iam/settings';
import { categoryLabels, verify } from '@/lib/credentials/store';
import { formatTime } from '../../administration/forms';

export const metadata: Metadata = { title: 'Vérification', robots: { index: false } };
export const dynamic = 'force-dynamic';

// Public, minimal disclosure (CRED-007/008): never the full name, matricule or content.
export default async function Verification({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const settings = iamSettings();
  const found = settings && /^[A-Za-z2-7]{26}$/.test(code) ? await verify(settings, code) : null;
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <h1>Vérification d’un document</h1>
        {!found ? <p className="studio-notice" role="alert">Aucun document ne correspond à ce code.</p> : <>
          <p className={found.state === 'issued' ? 'studio-notice success' : 'studio-notice'} role="status">
            {found.state === 'issued' ? 'Document authentique et en vigueur.' : `Document révoqué le ${formatTime(found.revoked_at)}.`}
            {found.replaced_by_number ? ` Remplacé par le document n° ${found.replaced_by_number}.` : ''}</p>
          <section className="facts">
            <div><span>Type</span><strong>{found.type_label}</strong></div>
            <div><span>Catégorie</span><strong>{categoryLabels[found.category]}</strong></div>
            <div><span>Autorité émettrice</span><strong>{found.issuing_authority}</strong></div>
            <div><span>Établissement</span><strong>{found.institution}</strong></div>
            <div><span>Numéro</span><strong>{found.number}</strong></div>
            <div><span>Délivré le</span><strong>{formatTime(found.issued_at)}</strong></div>
            <div><span>Titulaire</span><strong>{found.holder_initials ?? '—'}</strong></div>
          </section>
          <p className="muted">Ce registre ne délivre aucun diplôme national : les titres de l’État relèvent des autorités officielles.</p>
        </>}
      </section>
    </main>
  );
}
