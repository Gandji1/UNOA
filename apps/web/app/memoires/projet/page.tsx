import type { Metadata } from 'next';
import { levelLabels, outcomeLabels, projectDetails, projectStates, roleLabels } from '@/lib/theses/store';
import { ActionForm, Badge, Editor, formatTime, Hidden, Notice, Panel, Table } from '../../administration/forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Mémoire ou thèse' };
export const dynamic = 'force-dynamic';

const api = '/api/v1/thesis/';
const defenseStates: Record<string, string> = { planned: 'En préparation', convened: 'Jury convoqué', held: 'Tenue', cancelled: 'Annulée' };

export default async function Projet({ searchParams }: { searchParams: Promise<{ id?: string; error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = search.id ? await projectDetails(settings, actor, search.id).catch(refusedAs(null)) : null;
  if (!data) {
    return <main id="contenu" className="studio"><section className="studio-heading"><h1>Mémoire ou thèse</h1></section><p className="studio-notice" role="alert">Travail introuvable, confidentiel ou réservé.</p></main>;
  }
  const { project } = data;
  const back = `/memoires/projet?id=${project.id}`;
  const hidden = { projectId: project.id };
  const can = data.rights;
  const supervisor = data.supervision.some(item => item.account_id === actor && !item.ended_at);
  const isDirector = data.director === actor;
  const active = data.defenses.find(item => ['planned', 'convened'].includes(item.state));
  const held = data.defenses.find(item => item.state === 'held');
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/memoires/mes">Mémoires et thèses</a> › <span aria-current="page">{project.title}</span></nav>
      <section className="studio-heading"><p className="eyebrow">{levelLabels[project.level]} · {data.author}{project.confidential ? ' · confidentiel' : ''}</p><h1>{project.title}</h1>
        <p><Badge tone={project.state === 'archived' ? 'ok' : project.state === 'rejected' ? 'danger' : 'info'}>{projectStates[project.state]}</Badge>{data.validation_note ? ` ${data.validation_note}` : ''}</p></section>
      <Notice error={search.error} message={search.message} />

      <Panel title="Protocole" id="protocole">
        {data.abstract && <p>{data.abstract}</p>}
        {project.protocol ? <pre className="minutes">{project.protocol}</pre> : <p>Protocole à rédiger.</p>}
        {data.own && ['draft', 'rejected'].includes(project.state) && <>
          <ActionForm action={api + 'protocol'} back={back} hidden={hidden} submit="Enregistrer le protocole">
            <label className="studio-wide">Protocole (problématique, méthode, calendrier, sources)<textarea name="protocol" required rows={8} maxLength={20000} defaultValue={project.protocol ?? ''} /></label>
          </ActionForm>
          {project.protocol && <ActionForm inline action={api + 'submit'} back={back} hidden={hidden} submit="Soumettre pour validation" />}
        </>}
        {can?.validate && project.state === 'submitted' && !data.own && !supervisor && (
          <ActionForm action={api + 'validate-project'} back={back} hidden={hidden} submit="Statuer">
            <label>Décision<select name="decision"><option value="validated">Valider sujet et protocole</option><option value="rejected">À reprendre</option></select></label>
            <label className="studio-wide">Observation (motif obligatoire si à reprendre)<textarea name="note" maxLength={2000} /></label>
          </ActionForm>
        )}
      </Panel>

      <Panel title="Encadrement et jalons" id="encadrement">
        <ul>{data.supervision.map(item => <li key={item.account_id + String(item.ended_at)}>{item.name} — {item.role === 'director' ? 'Directeur' : 'Codirecteur'} ({item.qualification})
          {item.ended_at ? <> <Badge tone="muted">fin : {item.end_reason}</Badge></> : can?.manage && <ActionForm inline action={api + 'end-supervision'} back={back} hidden={{ ...hidden, accountId: item.account_id }} submit="Mettre fin">
            <label>Motif<input name="reason" required maxLength={500} /></label></ActionForm>}</li>)}</ul>
        {!data.director && project.state !== 'draft' && <p className="studio-notice" role="alert">Aucun directeur en fonction : le dépôt des versions est suspendu.</p>}
        {can?.manage && (
          <Editor summary="Désigner un encadrant">
            <ActionForm action={api + 'supervise'} back={back} hidden={hidden} submit="Désigner">
              <label>Personne<select name="accountId">{data.candidates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>Rôle<select name="role"><option value="director">Directeur</option><option value="co_director">Codirecteur</option></select></label>
              <label className="studio-wide">Qualification<input name="qualification" required maxLength={300} /></label>
            </ActionForm>
          </Editor>
        )}
        {data.milestones.length > 0 && <ul>{data.milestones.map(item => <li key={item.id}>{item.label} — {item.due_on} {item.done_at ? <Badge tone="ok">atteint</Badge>
          : (data.own || supervisor) && <ActionForm inline action={api + 'milestone-done'} back={back} hidden={{ ...hidden, milestoneId: item.id }} submit="Marquer atteint" />}</li>)}</ul>}
        {isDirector && <ActionForm inline action={api + 'milestones'} back={back} hidden={hidden} submit="Ajouter un jalon">
          <label>Jalon<input name="label" required maxLength={200} /></label><label>Échéance<input type="date" name="dueOn" required /></label></ActionForm>}
      </Panel>

      <Panel title="Versions, commentaires et intégrité" id="versions">
        {data.own && (project.state === 'validated' || project.state === 'defended') && (
          <form method="post" action={api + 'drafts'} encType="multipart/form-data" className="studio-inline">
            <Hidden values={{ return: back, projectId: project.id }} />
            <label>Nature<select name="kind">{project.state === 'validated' ? <option value="draft">Version de travail</option> : <><option value="corrected">Version corrigée</option><option value="final">Version définitive</option></>}</select></label>
            <input type="file" name="file" required accept=".pdf" aria-label="Document PDF" />
            <button className="secondary" type="submit">Déposer</button>
          </form>
        )}
        {data.drafts.length === 0 ? <p>Aucune version.</p> : data.drafts.map(draft => (
          <section key={draft.id} className="studio-panel">
            <h3>Version {draft.version} — {draft.kind === 'draft' ? 'travail' : draft.kind === 'final' ? 'définitive' : 'corrigée'} <a href={`${api}drafts/${draft.id}`}>{draft.filename}</a></h3>
            <p className="muted">{formatTime(draft.submitted_at)} · empreinte {draft.sha256.slice(0, 16)}…</p>
            {draft.checks.map((check, index) => <p key={index}><Badge tone={check.result === 'clear' ? 'ok' : 'danger'}>{check.result === 'clear' ? 'Intégrité vérifiée' : 'Suspicion de plagiat'}</Badge>
              {' '}{check.method === 'similarity_report' ? `similarité ${check.similarity} %` : 'examen humain'} — {check.note}</p>)}
            <ul>{draft.comments.map((comment, index) => <li key={index}><strong>{comment.author}</strong> ({formatTime(comment.at)}) : {comment.body}</li>)}</ul>
            {(supervisor || data.defenses.some(item => item.members.some(member => member.account_id === actor))) && (
              <ActionForm action={api + 'comments'} back={back} hidden={{ draftId: draft.id }} submit="Commenter">
                <label className="studio-wide">Commentaire et corrections<textarea name="body" required maxLength={8000} /></label>
              </ActionForm>
            )}
            {can?.integrity && !data.own && draft.kind === 'draft' && (
              <Editor summary="Contrôle d’intégrité">
                <ActionForm action={api + 'integrity'} back={back} hidden={{ draftId: draft.id }} submit="Enregistrer le contrôle">
                  <label>Méthode<select name="method"><option value="similarity_report">Rapport de similarité</option><option value="manual_review">Examen humain</option></select></label>
                  <label>Taux de similarité (%)<input name="similarity" inputMode="numeric" /></label>
                  <label>Résultat (examen humain)<select name="result"><option value="clear">Conforme</option><option value="suspected">Suspicion</option></select></label>
                  <label className="studio-wide">Constat<textarea name="note" required maxLength={4000} /></label>
                </ActionForm>
              </Editor>
            )}
          </section>
        ))}
      </Panel>

      <Panel title="Soutenance" id="soutenance">
        {can?.manage && !active && project.state === 'validated' && (
          <Editor summary="Planifier la soutenance">
            <ActionForm action={api + 'defenses'} back={back} hidden={hidden} submit="Planifier">
              <label>Modalité<select name="mode"><option value="onsite">Sur place</option><option value="online">En ligne</option><option value="hybrid">Hybride</option></select></label>
              <label>Date et heure (UTC)<input type="datetime-local" name="startsAt" required /></label>
              <label>Lieu<input name="place" maxLength={300} /></label>
              <label>Lien de visioconférence (https)<input type="url" name="meetingUrl" maxLength={2000} /></label>
            </ActionForm>
          </Editor>
        )}
        {data.defenses.map(defense => {
          const me = defense.members.find(member => member.account_id === actor);
          return (
            <section key={defense.id} className="studio-panel">
              <h3>{formatTime(defense.starts_at)} — {defense.mode === 'online' ? 'en ligne' : defense.place} <Badge tone={defense.state === 'held' ? 'ok' : 'info'}>{defenseStates[defense.state]}</Badge></h3>
              {defense.meeting_url && defense.state !== 'held' && (me || data.own) && <p><a href={defense.meeting_url} rel="noopener noreferrer">Rejoindre la soutenance en ligne</a></p>}
              <Table label="Jury" head={['Membre', 'Rôle', 'Présence', 'PV']}>
                {defense.members.map(member => <tr key={member.account_id}><td>{member.name}{member.external ? ' (extérieur)' : ''}</td><td>{roleLabels[member.role]}</td>
                  <td>{member.present === null ? '—' : member.present ? 'Présent' : 'Absent'}</td><td>{member.signed ? 'signé' : '—'}</td></tr>)}
              </Table>
              {defense.reports.map(report => <p key={report.account_id}><strong>Rapport de {report.name}</strong> : {report.opinion === 'favourable' ? 'favorable' : 'défavorable'} — {report.report}</p>)}
              {can?.manage && defense.state === 'planned' && <div className="studio-actions">
                <ActionForm inline action={api + 'jury'} back={back} hidden={{ defenseId: defense.id }} submit="Ajouter au jury">
                  <label>Personne<select name="accountId">{data.candidates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <label>Rôle<select name="role">{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label className="studio-check"><input type="checkbox" name="external" /> Extérieur</label>
                </ActionForm>
                <ActionForm inline action={api + 'convene'} back={back} hidden={{ defenseId: defense.id }} submit="Convoquer le jury" />
                <ActionForm inline action={api + 'cancel'} back={back} hidden={{ defenseId: defense.id }} submit="Annuler" />
              </div>}
              {me?.role === 'rapporteur' && defense.state === 'planned' && !defense.reports.some(report => report.account_id === actor) && (
                <ActionForm action={api + 'reports'} back={back} hidden={{ defenseId: defense.id }} submit="Déposer mon rapport">
                  <label>Avis<select name="opinion"><option value="favourable">Favorable à la soutenance</option><option value="unfavourable">Défavorable</option></select></label>
                  <label className="studio-wide">Rapport<textarea name="report" required rows={5} maxLength={20000} /></label>
                </ActionForm>
              )}
              {me?.role === 'president' && defense.state === 'convened' && (
                <ActionForm action={api + 'hold'} back={back} hidden={{ defenseId: defense.id }} submit="Établir le procès-verbal">
                  <fieldset className="studio-wide"><legend>Membres présents</legend>{defense.members.map(member => <label key={member.account_id} className="studio-check">
                    <input type="checkbox" name="present" value={member.account_id} defaultChecked /> {member.name}</label>)}</fieldset>
                  <label>Décision<select name="outcome">{Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label>Note (facultatif)<input name="mark" inputMode="decimal" /></label>
                  <label className="studio-wide">Délibération<textarea name="minutes" maxLength={8000} /></label>
                </ActionForm>
              )}
              {defense.minutes && <><pre className="minutes">{defense.minutes}</pre><p className="muted">Empreinte : <code>{defense.minutes_sha256}</code></p></>}
              {me?.present && defense.state === 'held' && !me.signed && <ActionForm inline action={api + 'sign'} back={back} hidden={{ defenseId: defense.id }} submit="Signer le procès-verbal" />}
            </section>
          );
        })}
      </Panel>

      <Panel title="Dépôt définitif" id="depot">
        {data.deposit ? <p>Version définitive acceptée le {formatTime(data.deposit.deposited_at)}{data.deposit.embargo_until ? ` · embargo jusqu’au ${data.deposit.embargo_until} (${data.deposit.embargo_reason})` : ' · sans embargo'}.</p>
          : isDirector && project.state === 'defended' && held ? (
            <ActionForm action={api + 'accept-deposit'} back={back} hidden={hidden} submit="Accepter la version définitive">
              <label>Embargo jusqu’au (facultatif)<input type="date" name="embargoUntil" /></label>
              <label className="studio-wide">Motif de l’embargo<input name="embargoReason" maxLength={1000} /></label>
            </ActionForm>
          ) : <p>Après une soutenance favorable, l’auteur dépose la version définitive (corrigée si demandé), acceptée par le directeur.</p>}
      </Panel>
    </main>
  );
}
