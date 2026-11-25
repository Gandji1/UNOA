import type { Metadata } from 'next';
import { juryDetails, outcomeLabels, sessionLabels } from '@/lib/grades/store';
import { ActionForm, Badge, Editor, formatTime, Notice, Panel, Table } from '../../forms';
import { learner, refusedAs } from '../../../apprendre/session';

export const metadata: Metadata = { title: 'Jury' };
export const dynamic = 'force-dynamic';

const api = '/api/v1/grd/';
const states: Record<string, [string, 'ok' | 'warn' | 'info']> = { constituted: ['Constitué', 'warn'], deliberated: ['Délibéré — signatures', 'info'], published: ['Publié', 'ok'] };

export default async function Jury({ searchParams }: { searchParams: Promise<{ id?: string; error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = search.id ? await juryDetails(settings, actor, search.id).catch(refusedAs(null)) : null;
  if (!data) {
    return (
      <main id="contenu" className="studio">
        <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration/notes">Notes et jurys</a> › <span aria-current="page">Jury</span></nav>
        <section className="studio-heading"><h1>Jury</h1></section>
        <p className="studio-notice" role="alert">Jury introuvable ou réservé à ses membres.</p>
      </main>
    );
  }
  const { jury } = data;
  const back = `/administration/notes/jury?id=${jury.id}`;
  const hidden = { juryId: jury.id };
  const isPresident = data.member?.role === 'president';
  const signed = (id: string) => data.signatures.some(item => item.account_id === id && item.sha256 === jury.minutes_sha256);
  const unit = (id: string) => data.units.find(item => item.id === id);
  const current = data.decisions.filter(item => !item.superseded);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › <a href={`/administration/notes?scope=${jury.scope_id}`}>Notes et jurys</a> › <span aria-current="page">{jury.label}</span></nav>
      <section className="studio-heading"><p className="eyebrow">{data.cohort} · {data.period} · {sessionLabels[jury.session]}</p><h1>{jury.label}</h1>
        <p><Badge tone={states[jury.state][1]}>{states[jury.state][0]}</Badge> Règle : {data.policy.label} · quorum {jury.quorum} · publication prévue le {formatTime(jury.publish_at)}</p></section>
      <Notice error={search.error} message={search.message} />

      <Panel title="Composition" id="membres">
        <Table label="Membres du jury" head={['Membre', 'Rôle', 'Présence', 'Signature du PV', '']}>
          {data.members.map(item => <tr key={item.account_id}><td>{item.name}</td><td>{item.role === 'president' ? 'Président' : 'Membre'}</td>
            <td>{item.present === null ? '—' : item.present ? 'Présent' : 'Absent'}</td><td>{item.present ? (signed(item.account_id) ? <Badge tone="ok">signé</Badge> : <Badge tone="warn">en attente</Badge>) : '—'}</td>
            <td>{data.rights?.jury && jury.state === 'constituted' && <ActionForm inline action={api + 'remove-member'} back={back} hidden={{ ...hidden, accountId: item.account_id }} submit="Retirer" />}</td></tr>)}
        </Table>
        {data.rights?.jury && jury.state === 'constituted' && (
          <ActionForm inline action={api + 'members'} back={back} hidden={hidden} submit="Ajouter au jury">
            <label>Personne<select name="accountId">{data.candidates.map(item => <option key={item.id} value={item.id}>{item.name ?? item.id.slice(0, 8)}</option>)}</select></label>
            <label>Rôle<select name="role"><option value="member">Membre</option><option value="president">Président</option></select></label>
          </ActionForm>
        )}
        {data.rights?.jury && jury.state !== 'published' && (
          <ActionForm inline action={api + 'calendar'} back={back} hidden={hidden} submit="Modifier la date de publication">
            <label>Publication (UTC)<input type="datetime-local" name="publishAt" required /></label>
          </ActionForm>
        )}
      </Panel>

      {isPresident && jury.state === 'constituted' && (
        <Panel title="Délibération" id="deliberer">
          <p className="studio-help">Les décisions sont calculées à partir des notes validées et de la règle en vigueur ; elles ne se saisissent pas à la main.</p>
          <ActionForm action={api + 'deliberate'} back={back} hidden={hidden} submit="Délibérer">
            <fieldset className="studio-wide"><legend>Membres présents</legend>
              {data.members.map(item => <label key={item.account_id} className="studio-check"><input type="checkbox" name="present" value={item.account_id} defaultChecked={item.account_id === actor} /> {item.name}</label>)}</fieldset>
            <label className="studio-wide">Observations du jury<textarea name="minutes" maxLength={8000} /></label>
          </ActionForm>
        </Panel>
      )}

      {jury.minutes && (
        <Panel title="Procès-verbal" id="pv" actions={<a className="secondary" href={`${api}jury-minutes/${jury.id}`}>Télécharger le PV</a>}>
          <pre className="minutes">{jury.minutes}</pre>
          <p className="muted">Empreinte : <code>{jury.minutes_sha256}</code></p>
          <div className="studio-actions">
            {data.member?.present && jury.state === 'deliberated' && !signed(actor) && <ActionForm inline action={api + 'sign'} back={back} hidden={hidden} submit="Signer le procès-verbal" />}
            {isPresident && jury.state === 'deliberated' && <ActionForm inline action={api + 'publish'} back={back} hidden={hidden} submit="Publier les résultats" />}
          </div>
        </Panel>
      )}

      {data.decisions.length > 0 && (
        <Panel title="Décisions" id="decisions">
          <Table label="Décisions du jury" head={['Étudiant', 'Moyenne', 'Résultat', 'Crédits', 'Unités', '']}>
            {data.decisions.map(item => <tr key={item.id}><td>{item.name}<br /><span className="muted">{item.matricule}</span></td><td>{item.average ?? '—'}</td>
              <td>{outcomeLabels[item.outcome as keyof typeof outcomeLabels]}</td><td>{Number(item.credits)}</td>
              <td>{item.units.map(row => `${unit(row.unitId)?.code ?? '?'} ${row.mark ?? '—'}${row.compensated ? ' (compensée)' : row.passed ? '' : ' (non validée)'}`).join(' · ')}</td>
              <td>{item.superseded ? <Badge tone="muted">remplacée par avenant</Badge> : item.amends ? <Badge tone="info">avenant</Badge> : null}</td></tr>)}
          </Table>
        </Panel>
      )}

      {(data.appeals.length > 0 || data.rectifications.length > 0) && (
        <Panel title="Contestations et avenants" id="avenants">
          <ul>{data.appeals.map(item => <li key={item.id}>{item.name} : {item.reason} — {item.state === 'filed' ? 'à instruire' : item.state === 'upheld' ? 'fondée' : 'rejetée'}{item.response ? ' · ' + item.response : ''}</li>)}</ul>
          <ul>{data.rectifications.map(item => <li key={item.id}>Avenant du {formatTime(item.created_at)} — {item.name} : {item.reason}</li>)}</ul>
        </Panel>
      )}

      {isPresident && jury.state !== 'constituted' && current.length > 0 && (
        <Panel title="Rectifier par avenant" id="rectifier">
          <Editor summary="Rectifier le résultat d’un étudiant">
            <ActionForm action={api + 'rectify'} back={back} hidden={hidden} submit="Établir l’avenant">
              <label>Étudiant<select name="registrationId">{current.map(item => <option key={item.registration_id} value={item.registration_id}>{item.name} · {item.matricule}</option>)}</select></label>
              <label>Contestation fondée (facultatif)<select name="appealId"><option value="">—</option>
                {data.appeals.filter(item => item.state === 'upheld').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              {data.units.map(item => <label key={item.id}>{item.code} — nouvelle note<input name={`m.${item.id}`} inputMode="decimal" /></label>)}
              <label className="studio-wide">Motif<textarea name="reason" required maxLength={4000} /></label>
            </ActionForm>
          </Editor>
        </Panel>
      )}
    </main>
  );
}
