import type { Metadata } from 'next';
import { iamSettings } from '@/lib/iam/settings';
import { currentSite } from '@/lib/site/store';
import { publicDecisions } from '@/lib/governance/store';

export const metadata: Metadata = { title: 'Décisions publiées' };
export const dynamic = 'force-dynamic';

const outcomes: Record<string, string> = { adopted: 'Adoptée', rejected: 'Rejetée', noted: 'Prise d’acte' };

export default async function Decisions() {
  const settings = iamSettings();
  const site = settings ? await currentSite() : null;
  const decisions = settings && site ? await publicDecisions(settings, site.site_id).catch(() => []) : [];
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <h1>Décisions publiées</h1>
        <p>Décisions des conseils de l’établissement rendues publiques, après signature du procès-verbal.</p>
        {decisions.length === 0 ? <p>Aucune décision publiée.</p> : (
          <ul>{decisions.map((item, index) => <li key={index}><strong>{item.council}</strong> — {item.title} ({outcomes[item.outcome]})
            <p>{item.summary}</p>{item.effective_on && <p className="muted">Effet : {item.effective_on}</p>}</li>)}</ul>
        )}
      </section>
    </main>
  );
}
