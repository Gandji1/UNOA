import type { Metadata } from 'next';
import { iamSettings } from '@/lib/iam/settings';
import { levelLabels, publicArchive } from '@/lib/theses/store';
import { formatTime } from '../administration/forms';

export const metadata: Metadata = { title: 'Mémoires et thèses' };
export const dynamic = 'force-dynamic';

export default async function Memoires() {
  const settings = iamSettings();
  const items = settings ? await publicArchive(settings).catch(() => []) : [];
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <h1>Mémoires et thèses</h1>
        <p>Travaux soutenus et déposés dans leur version définitive. Les travaux confidentiels n’apparaissent pas ; un document sous embargo n’est consultable qu’à sa levée.</p>
        {items.length === 0 ? <p>Aucun travail archivé.</p> : (
          <ul>{items.map(item => <li key={item.id}><strong>{item.title}</strong> — {item.author} · {levelLabels[item.level]} · {item.institution} · déposé le {formatTime(item.deposited_at)}
            {item.open ? <> · <a href={`/api/v1/thesis/drafts/${item.draft_id}`}>Télécharger</a></> : <> · sous embargo jusqu’au {item.embargo_until}</>}</li>)}</ul>
        )}
        <p><a href="/memoires/mes">Mon mémoire ou ma thèse</a></p>
      </section>
    </main>
  );
}
