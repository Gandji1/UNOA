import type { Metadata } from 'next';
import { scopeIdFormat } from '@/lib/iam/settings';
import { eventLabels, internshipDetails, internshipSpace, internshipStates, partyLabels } from '@/lib/internships/store';
import { ActionForm, Badge, Editor, Hidden, Notice, Panel, Table } from '../administration/forms';
import { learner, refusedAs } from '../apprendre/session';

export const metadata: Metadata = { title: 'Mes stages' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const api = '/api/v1/stg/';
const relations: Record<string, string> = { student: 'Stagiaire', tutor: 'Maître de stage', academic: 'Encadreur académique', company: 'Entreprise', staff: 'Établissement' };
const logKinds: Record<string, string> = { log: 'Journal', milestone: 'Jalon', absence: 'Absence' };
const today = () => new Date().toISOString().slice(0, 10);

export default async function Stages({ searchParams }: { searchParams: Promise<Search> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const id = field(search.id);
  if (scopeIdFormat.test(id)) {
    const data = await internshipDetails(settings, actor, id).catch(refusedAs(null));
    if (data) return <Detail data={data} notice={notice} />;
  }
  const space = await internshipSpace(settings, actor);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Mes stages</span></nav>
      <section className="studio-heading"><p className="eyebrow">Stages</p><h1>Mes stages</h1>
        <p>Demande → acceptation → convention signée → journal et échanges → rapport → évaluations → validation.</p></section>
      {notice}
      <Panel title="Stages" id="liste">
        {space.internships.length === 0 ? <p>Aucun stage.</p> : (
          <Table label="Stages" head={['Stage', 'Entreprise', 'Stagiaire', 'Période', 'Vous êtes', 'État']}>
            {space.internships.map(item => <tr key={item.id}><td><a href={'/stages?id=' + item.id}>{item.title}</a></td><td>{item.company}</td><td>{item.student}</td>
              <td>{item.starts_on} → {item.ends_on}</td><td>{relations[item.relation]}</td><td>{internshipStates[item.state]}</td></tr>)}
          </Table>
        )}
      </Panel>
      {space.companies.length > 0 && (
        <Editor summary="Demander un stage">
          <ActionForm action={api + 'request'} back="/stages" submit="Envoyer la demande">
            <label>Entreprise d’accueil<select name="companyId">{space.companies.map(item => <option key={item.id} value={item.id}>{item.name}{item.city ? ' — ' + item.city : ''}</option>)}</select></label>
            {space.registrations.length > 0 ? (
              <>
                <label>Inscription<select name="registrationId">{space.registrations.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                <label>Unité de stage (si prévue)<select name="unitId" defaultValue=""><option value="">Aucune</option>{space.registrations.flatMap(item => item.units).map(unit => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>
              </>
            ) : <label>Formation suivie<input name="freeTraining" required maxLength={300} /></label>}
            <label className="studio-wide">Intitulé du stage<input name="title" required maxLength={300} /></label>
            <label className="studio-wide">Missions<textarea name="missions" required rows={4} maxLength={8000} /></label>
            <label>Lieu<input name="place" maxLength={300} /></label>
            <label>Début<input type="date" name="startsOn" required /></label>
            <label>Fin<input type="date" name="endsOn" required /></label>
            <label>Heures par semaine<input name="weeklyHours" required inputMode="numeric" defaultValue="35" /></label>
          </ActionForm>
        </Editor>
      )}
      {space.companies.length === 0 && <p className="card-note">Aucune entreprise partenaire approuvée pour le moment.</p>}
    </main>
  );
}

type Data = Awaited<ReturnType<typeof internshipDetails>>;
function Detail({ data, notice }: { data: Data; notice: React.ReactNode }) {
  const item = data.internship;
  const back = '/stages?id=' + item.id;
  const party = data.relation;
  const signed = new Set(data.signatures.map(row => row.party));
  const mySide = party === 'student' ? 'student' : party === 'company' ? 'company' : data.rights?.sign ? 'institution' : null;
  const running = ['active', 'report'].includes(item.state);
  const manage = !!data.rights?.manage;
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/stages">Mes stages</a> › <span aria-current="page">{item.title}</span></nav>
      <section className="studio-heading"><p className="eyebrow">{relations[party]} · {data.scope}</p><h1>{item.title}</h1>
        <p>{data.student} chez {data.company} · {item.starts_on} → {item.ends_on} · {item.weekly_hours} h par semaine · <Badge tone={item.state === 'validated' ? 'ok' : item.state === 'broken' ? 'danger' : 'info'}>{internshipStates[item.state]}</Badge></p></section>
      {notice}
      <Panel title="Mission" id="mission">
        <p>{item.missions}</p>
        <p className="muted">{data.unit ? 'Unité : ' + data.unit : 'Formation : ' + (item.free_training ?? '')}{item.place ? ' · Lieu : ' + item.place : ''}</p>
        {party === 'student' && ['requested', 'approved'].includes(item.state) && <ActionForm inline action={api + 'cancel'} back={back} hidden={{ internshipId: item.id }} submit="Annuler ma demande" confirm="La demande sera annulée." />}
        {manage && item.state === 'requested' && (
          <ActionForm action={api + 'decide'} back={back} hidden={{ internshipId: item.id }} submit="Enregistrer la décision">
            <label>Décision<select name="decision"><option value="approved">Accepter</option><option value="rejected">Refuser</option></select></label>
            <label className="studio-wide">Observation (obligatoire pour un refus)<input name="note" maxLength={2000} /></label>
          </ActionForm>
        )}
      </Panel>

      <Panel title="Encadrement" id="encadrement">
        <ul>{data.supervisors.filter(row => !row.ended_at).map(row => <li key={row.role + row.assigned_at}>{row.role === 'company' ? 'Maître de stage' : 'Encadreur académique'} : {row.name}</li>)}</ul>
        {!data.tutor && !['requested', 'rejected', 'cancelled', 'validated', 'broken'].includes(item.state) && <p className="studio-notice" role="note">Maître de stage absent : l’entreprise doit en désigner un.</p>}
        {data.team.length > 0 && ['approved', 'signing', 'active', 'report'].includes(item.state) && (party === 'company' || manage) && (
          <ActionForm inline action={api + 'supervisors'} back={back} hidden={{ internshipId: item.id, role: 'company' }} submit="Désigner le maître de stage">
            <label>Maître de stage<select name="accountId">{data.team.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          </ActionForm>
        )}
        {manage && data.people.length > 0 && ['approved', 'signing', 'active', 'report'].includes(item.state) && (
          <ActionForm inline action={api + 'supervisors'} back={back} hidden={{ internshipId: item.id, role: 'academic' }} submit="Désigner l’encadreur">
            <label>Encadreur académique<select name="accountId">{data.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          </ActionForm>
        )}
      </Panel>

      <Panel title="Convention" id="convention">
        {manage && item.state === 'approved' && (data.templates.length === 0 || data.grids.length === 0
          ? <p>Créez d’abord un modèle de convention approuvé et une grille d’évaluation dans l’administration des stages.</p>
          : <ActionForm action={api + 'agreement'} back={back} hidden={{ internshipId: item.id }} submit="Établir la convention">
              <label>Modèle<select name="templateId">{data.templates.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
              <label>Grille d’évaluation<select name="gridId">{data.grids.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
            </ActionForm>)}
        {item.agreement ? (
          <>
            <pre className="agreement">{item.agreement}</pre>
            <p className="muted">Empreinte : {item.agreement_sha256?.slice(0, 16)}… · Signatures : {(['student', 'company', 'institution'] as const).map(key => `${partyLabels[key]} ${signed.has(key) ? '✓' : '—'}`).join(' · ')}</p>
            {item.state === 'signing' && mySide && !signed.has(mySide) && (
              <ActionForm inline action={api + 'sign'} back={back} hidden={{ internshipId: item.id, sha256: item.agreement_sha256 ?? '' }} submit={'Signer pour : ' + partyLabels[mySide].toLowerCase()} />
            )}
          </>
        ) : <p>La convention sera établie par l’établissement après l’acceptation et la désignation des encadrants.</p>}
      </Panel>

      {!['requested', 'rejected', 'cancelled'].includes(item.state) && (
        <Panel title="Journal de bord" id="journal">
          {running && ['student', 'tutor', 'academic'].includes(party) && (
            <ActionForm action={api + 'log'} back={back} hidden={{ internshipId: item.id }} submit="Ajouter">
              <label>Date<input type="date" name="entryOn" required defaultValue={today()} /></label>
              <label>Nature<select name="kind"><option value="log">Journal</option><option value="milestone">Jalon</option>{party !== 'student' && <option value="absence">Absence du stagiaire</option>}</select></label>
              <label className="studio-wide">Contenu<textarea name="body" required rows={3} maxLength={8000} /></label>
            </ActionForm>
          )}
          {data.logs.length === 0 ? <p>Aucune entrée.</p> : <ul>{data.logs.map((row, index) => <li key={index}><strong>{row.entry_on} · {logKinds[row.kind]}</strong> — {row.body} <span className="muted">({row.author})</span></li>)}</ul>}
        </Panel>
      )}

      {!['requested', 'rejected', 'cancelled'].includes(item.state) && (
        <Panel title="Échanges" id="echanges">
          {data.messages.length === 0 ? <p>Aucun message.</p> : <ul>{data.messages.map((row, index) => <li key={index}><strong>{row.author}</strong> : {row.body}</li>)}</ul>}
          <ActionForm inline action={api + 'message'} back={back} hidden={{ internshipId: item.id }} submit="Envoyer">
            <label className="studio-wide">Message<input name="body" required maxLength={8000} /></label>
          </ActionForm>
        </Panel>
      )}

      {['active', 'report', 'evaluated', 'validated'].includes(item.state) && (
        <Panel title="Rapport de stage" id="rapport">
          {data.reports.length === 0 ? <p>Aucun rapport déposé.</p> : <ul>{data.reports.map(row => <li key={row.id}>Version {row.version}{row.confidential ? ' (confidentiel)' : ''} — <a href={api + 'reports/' + row.id}>{row.filename}</a></li>)}</ul>}
          {party === 'student' && running && (
            <form method="post" action={api + 'reports'} encType="multipart/form-data" className="studio-inline">
              <Hidden values={{ return: back, internshipId: item.id }} />
              <input type="file" name="file" required accept=".pdf" aria-label="Rapport PDF" />
              <label className="studio-check"><input type="checkbox" name="confidential" /> Confidentiel (non visible du recruteur)</label>
              <button className="secondary" type="submit">Déposer le rapport</button>
            </form>
          )}
        </Panel>
      )}

      {['report', 'evaluated', 'validated'].includes(item.state) && (
        <Panel title="Évaluations" id="evaluations">
          {data.reviews.map(row => <p key={row.role}><strong>{row.role === 'company' ? 'Entreprise' : 'Encadreur académique'}</strong> : {row.mark} / {data.grid?.scale} — {row.scores.map(score => `${score.label} ${score.score}`).join(', ')}{row.comment ? ' · ' + row.comment : ''}</p>)}
          {party === 'student' && item.state !== 'validated' && <p>Les évaluations vous seront visibles après la validation.</p>}
          {item.state === 'report' && data.grid && ['tutor', 'academic'].includes(party) && !data.reviews.some(row => row.role === (party === 'tutor' ? 'company' : 'academic')) && (
            <ActionForm action={api + 'review'} back={back} hidden={{ internshipId: item.id }} submit="Enregistrer mon évaluation">
              {data.grid.criteria.map((criterion, index) => <label key={index}>{criterion.label} (poids {criterion.weight}, sur {data.grid!.scale})<input name={'score' + index} required inputMode="decimal" /></label>)}
              <label className="studio-wide">Appréciation<textarea name="comment" rows={2} maxLength={4000} /></label>
            </ActionForm>
          )}
          {data.rights?.validate && item.state === 'evaluated' && (
            <ActionForm action={api + 'validate'} back={back} hidden={{ internshipId: item.id }} submit="Valider le stage" confirm="La note sera transmise comme note provisoire de l’unité.">
              <label>Note finale (moyenne des évaluations si vide)<input name="mark" inputMode="decimal" /></label>
            </ActionForm>
          )}
          {item.state === 'validated' && <p><Badge tone="ok">Stage validé</Badge> Note : {data.mark}</p>}
        </Panel>
      )}

      <Panel title="Événements" id="evenements">
        {data.events.length === 0 ? <p>Aucun événement.</p> : <ul>{data.events.map((row, index) => <li key={index}>{eventLabels[row.kind]} — {row.reason}{row.new_end ? ` (nouvelle fin : ${row.new_end})` : ''} <span className="muted">({row.actor})</span></li>)}</ul>}
        {!['rejected', 'cancelled', 'validated', 'broken'].includes(item.state) && (
          <Editor summary="Signaler un événement">
            <ActionForm action={api + 'event'} back={back} hidden={{ internshipId: item.id }} submit="Enregistrer">
              <label>Événement<select name="kind">
                <option value="dispute">Litige</option>
                {party !== 'tutor' && <option value="tutor_absent">Maître de stage absent</option>}
                {manage && <><option value="resolve">Litige résolu</option><option value="extend">Prolongation</option><option value="postpone">Report</option><option value="break">Rupture de la convention</option></>}
              </select></label>
              {manage && <><label>Nouveau début (report)<input type="date" name="newStart" /></label><label>Nouvelle fin (report, prolongation)<input type="date" name="newEnd" /></label></>}
              <label className="studio-wide">Motif<input name="reason" required maxLength={2000} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>
    </main>
  );
}
