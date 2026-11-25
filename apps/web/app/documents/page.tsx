import type { Metadata } from 'next';
import { categoryLabels, myDocuments, stateLabels } from '@/lib/credentials/store';
import { evidenceStates, kindLabels } from '@/lib/external/store';
import { Badge, formatTime, Notice, Panel, Table } from '../administration/forms';
import { learner } from '../apprendre/session';

export const metadata: Metadata = { title: 'Mes documents' };
export const dynamic = 'force-dynamic';

export default async function Documents({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = await myDocuments(settings, actor);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Mes documents</span></nav>
      <section className="studio-heading"><p className="eyebrow">Attestations et diplômes</p><h1>Mes documents</h1>
        <p>Documents délivrés par votre établissement, vérifiables par QR code. Les diplômes nationaux restent délivrés par l’autorité officielle.</p></section>
      <Notice error={search.error} message={search.message} />
      <Panel title="Délivrés par l’établissement" id="delivres">
        {data.credentials.length === 0 ? <p>Aucun document.</p> : (
          <Table label="Mes documents" head={['Document', 'Numéro', 'Établissement', 'Délivré le', 'État', '']}>
            {data.credentials.map(item => <tr key={item.id}><td>{item.type}<br /><span className="muted">{categoryLabels[item.category]}</span></td><td>{item.number}</td><td>{item.institution}</td>
              <td>{formatTime(item.issued_at)}</td><td><Badge tone={item.state === 'issued' ? 'ok' : 'danger'}>{stateLabels[item.state]}</Badge></td>
              <td>{item.state === 'issued' && <><a href={`/documents/voir?id=${item.id}`}>Afficher et imprimer</a>{item.category === 'badge' && <> · <a href={`/api/v1/cred/badges/${item.id}`}>Exporter le badge</a></>}</>}</td></tr>)}
          </Table>
        )}
      </Panel>
      <Panel title="Diplômes et résultats externes déposés" id="externes">
        <p className="studio-help">Pièces officielles délivrées par une autorité extérieure : la plateforme en conserve la copie et l’état de vérification, sans jamais les réémettre.</p>
        {data.external.length === 0 ? <p>Aucune pièce externe.</p> : <ul>{data.external.map(item => <li key={item.id}>{kindLabels[item.kind]} — {item.exam}, délivré par {item.issuing_authority}{' '}
          <Badge tone={item.state === 'verified' ? 'ok' : item.state === 'rejected' ? 'danger' : 'warn'}>{evidenceStates[item.state]}</Badge></li>)}</ul>}
      </Panel>
    </main>
  );
}
