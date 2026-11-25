import type { Metadata } from 'next';
import { credentialView, stateLabels } from '@/lib/credentials/store';
import { formatTime } from '../../administration/forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Document' };
export const dynamic = 'force-dynamic';

export default async function Voir({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { settings, actor } = await learner();
  const { id } = await searchParams;
  const view = id ? await credentialView(settings, actor, id, settings.origin.origin).catch(refusedAs(null)) : null;
  if (!view) {
    return <main id="contenu" className="page"><section className="account-panel"><h1>Document</h1><p role="alert">Document introuvable, non délivré ou réservé.</p></section></main>;
  }
  return (
    <main id="contenu" className="page">
      <article className="account-panel credential">
        <p className="eyebrow">{view.institution} · {stateLabels[view.state]}</p>
        <h1>{view.type} — n° {view.number}</h1>
        <pre className="minutes">{view.rendered}</pre>
        <p>Signé par : {view.signatures.map(item => `${item.signer ?? ''} (${formatTime(item.at)})`).join(' ; ') || '—'}</p>
        <div className="qr" role="img" aria-label="QR code de vérification du document" dangerouslySetInnerHTML={{ __html: view.qr }} />
        <p>Vérification : <a href={view.url}>{view.url}</a></p>
        <p className="muted">Empreinte SHA-256 : <code>{view.sha256}</code></p>
      </article>
    </main>
  );
}
