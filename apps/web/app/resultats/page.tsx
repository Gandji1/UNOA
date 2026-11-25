import type { Metadata } from 'next';
import { myResults, outcomeLabels, sessionLabels } from '@/lib/grades/store';
import { ActionForm, Badge, formatTime, Notice, Panel, Table } from '../administration/forms';
import { learner } from '../apprendre/session';

export const metadata: Metadata = { title: 'Mes résultats' };
export const dynamic = 'force-dynamic';

const api = '/api/v1/grd/';
const back = '/resultats';
const appealStates: Record<string, string> = { filed: 'en cours d’examen', rejected: 'rejetée', upheld: 'fondée' };

export default async function Resultats({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = await myResults(settings, actor);
  const unit = (id: string) => data.units.find(item => item.id === id);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Mes résultats</span></nav>
      <section className="studio-heading"><p className="eyebrow">Notes et crédits</p><h1>Mes résultats</h1>
        <p>Résultats publiés par les jurys, crédits acquis (capitalisés d’une année à l’autre), contestation dans le délai et relevé de notes scellé.</p></section>
      <Notice error={search.error} message={search.message} />
      <section className="facts"><div><span>Crédits acquis</span><strong>{data.credits}</strong></div><div><span>Résultats publiés</span><strong>{data.decisions.length}</strong></div></section>
      {data.decisions.length === 0 ? <Panel title="Résultats" id="resultats"><p>Aucun résultat publié pour le moment.</p></Panel> : data.decisions.map(item => {
        const open = new Date(item.appeal_until).getTime() > Date.now() && (!item.appeal || item.appeal.state !== 'filed');
        return (
          <Panel key={item.id} title={`${item.period} — ${sessionLabels[item.session]}`} id={'d' + item.id.slice(0, 8)}>
            <p>{item.program} · {item.institution} · publié le {formatTime(item.published_at)}{item.rectified && <> <Badge tone="info">rectifié par avenant</Badge></>}</p>
            <p><strong>{outcomeLabels[item.outcome as keyof typeof outcomeLabels]}</strong> · moyenne {item.average ?? '—'} / {Number(item.scale_max)} · {Number(item.credits)} crédit(s)</p>
            <Table label={'Unités — ' + item.period} head={['Unité', 'Note', 'Crédits', 'État']}>
              {item.units.map(row => <tr key={row.unitId}><td>{unit(row.unitId)?.code} — {unit(row.unitId)?.title}</td><td>{row.mark ?? '—'}</td><td>{row.credits}</td>
                <td>{row.passed ? 'Validée' : row.compensated ? 'Compensée' : 'Non validée'}</td></tr>)}
            </Table>
            {item.appeal && <p>Contestation {appealStates[item.appeal.state]}{item.appeal.response ? ' — ' + item.appeal.response : ''}</p>}
            {open ? (
              <ActionForm action={api + 'appeal'} back={back} hidden={{ decisionId: item.id }} submit="Contester ce résultat">
                <label className="studio-wide">Motif (jusqu’au {formatTime(item.appeal_until)})<textarea name="reason" required maxLength={4000} /></label>
              </ActionForm>
            ) : <p className="muted">Délai de contestation : jusqu’au {formatTime(item.appeal_until)}.</p>}
          </Panel>
        );
      })}
      {data.decisions.length > 0 && (
        <Panel title="Relevé de notes" id="releve">
          <p>Le relevé est établi à partir des seuls résultats publiés et reçoit une empreinte vérifiable par l’établissement. Il ne constitue pas un diplôme.</p>
          <p><a className="action" href={api + 'transcript'}>Télécharger mon relevé (JSON scellé)</a></p>
        </Panel>
      )}
    </main>
  );
}
