import type { Metadata } from 'next';
import { teacherSpace, functionLabels } from '@/lib/teachers/store';
import { ActionForm, Badge, Editor, formatTime, Hidden, Notice, Panel, Table } from '../administration/forms';
import { learner } from '../apprendre/session';

export const metadata: Metadata = { title: 'Espace enseignant' };
export const dynamic = 'force-dynamic';

const api = '/api/v1/tea/';
const back = '/enseignement';
const states: Record<string, [string, 'ok' | 'warn' | 'muted' | 'info' | 'danger']> = {
  draft: ['Brouillon', 'warn'], submitted: ['Déposée', 'info'], review: ['En expertise', 'info'], decided: ['Décidée', 'ok'], withdrawn: ['Retirée', 'muted'],
};
const contractStates: Record<string, string> = { draft: 'À signer', signed: 'Signé', suspended: 'Suspendu', ended: 'Terminé' };

export default async function Enseignement({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = await teacherSpace(settings, actor);
  const profile = data.profile as Record<string, string | null> | null;
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Espace enseignant</span></nav>
      <section className="studio-heading"><p className="eyebrow">Enseigner</p><h1>Espace enseignant</h1>
        <p>Profil, appels à candidatures, candidature (syllabus, proposition pédagogique, diplôme, CV), contrats, affectations et obligations.</p></section>
      <Notice error={search.error} message={search.message} />
      <Panel title="Mon profil enseignant" id="profil">
        <ActionForm action={api + 'profile'} back={back} submit="Enregistrer le profil">
          <label>Titre<input name="title" maxLength={120} defaultValue={profile?.title ?? ''} placeholder="ex. Docteur, Maître de conférences" /></label>
          <label>Discipline<input name="discipline" required maxLength={200} defaultValue={profile?.discipline ?? ''} /></label>
          <label className="studio-wide">Parcours<textarea name="biography" maxLength={4000} defaultValue={profile?.biography ?? ''} /></label>
          <label className="studio-wide">Publications<textarea name="publications" maxLength={8000} defaultValue={profile?.publications ?? ''} /></label>
          <label className="studio-wide">Disponibilités<input name="availability" maxLength={1000} defaultValue={profile?.availability ?? ''} /></label>
        </ActionForm>
      </Panel>
      <Panel title="Appels à candidatures" id="appels">
        {data.openings.length === 0 ? <p>Aucun appel ouvert.</p> : (
          <ul className="program-grid">{data.openings.map(item => (
            <li key={item.id} className="program-card"><p className="eyebrow">{item.scope_label} · {item.level}{item.region ? ' · ' + item.region : ''}</p>
              <h3>{item.title}</h3><p className="muted">{item.discipline} — clôture le {formatTime(item.closes_at)}</p><p>{item.description}</p>
              <ActionForm action={api + 'apply'} back={back} hidden={{ openingId: item.id }} submit="Candidater">
                <label className="studio-wide">Cours proposé<input name="courseTitle" required maxLength={200} /></label>
              </ActionForm></li>
          ))}</ul>
        )}
        {data.openings[0] && (
          <Editor summary="Candidature spontanée (proposition de cours)">
            <ActionForm action={api + 'apply'} back={back} submit="Créer la candidature">
              <label>Établissement ou composante<select name="scopeId">{[...new Map(data.openings.map(item => [item.scope_id, item.scope_label])).entries()].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
              <label>Cours proposé<input name="courseTitle" required maxLength={200} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>
      <Panel title="Mes candidatures" id="candidatures">
        {data.applications.length === 0 ? <p>Aucune candidature.</p> : data.applications.map(item => (
          <section key={item.id} className="studio-panel">
            <h3>{item.course_title} <Badge tone={states[item.state][1]}>{states[item.state][0]}</Badge>
              {item.decision && <Badge tone={item.decision === 'accepted' ? 'ok' : 'danger'}>{item.decision === 'accepted' ? 'Retenue' : 'Non retenue'}</Badge>}</h3>
            <p className="muted">{item.opening_title ?? 'Candidature spontanée'} · {item.scope_label}{item.decision_reason ? ' · ' + item.decision_reason : ''}</p>
            {item.state === 'draft' && <>
              <ActionForm action={api + 'proposal'} back={back} hidden={{ applicationId: item.id }} submit="Enregistrer la proposition">
                <label className="studio-wide">Cours proposé<input name="courseTitle" required maxLength={200} defaultValue={item.course_title} /></label>
                <label className="studio-wide">Syllabus (objectifs, plan, séances, évaluation)<textarea name="syllabus" rows={6} maxLength={12000} /></label>
                <label className="studio-wide">Proposition pédagogique<textarea name="pedagogy" rows={4} maxLength={6000} /></label>
              </ActionForm>
              <form method="post" action={api + 'documents'} encType="multipart/form-data" className="studio-inline">
                <Hidden values={{ return: back, applicationId: item.id }} />
                <select name="kind" aria-label="Pièce"><option value="diploma">Diplôme</option><option value="cv">CV</option><option value="reference">Référence</option><option value="publication">Publication</option></select>
                <input type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg" aria-label="Fichier" />
                <button className="secondary" type="submit">Déposer la pièce</button>
              </form>
              <div className="studio-actions">
                <ActionForm inline action={api + 'submit'} back={back} hidden={{ applicationId: item.id }} submit="Déposer la candidature" />
                <ActionForm inline action={api + 'withdraw'} back={back} hidden={{ applicationId: item.id }} submit="Retirer" />
              </div>
            </>}
          </section>
        ))}
      </Panel>
      <Panel title="Mes contrats" id="contrats">
        {data.contracts.length === 0 ? <p>Aucun contrat.</p> : (
          <Table label="Contrats" head={['Établissement', 'Fonction', 'Période', 'Heures', 'Rémunération', 'État', '']}>
            {data.contracts.map(item => <tr key={item.id}><td>{item.scope_label}</td><td>{functionLabels[item.function]}</td><td>{item.starts_on} → {item.ends_on}</td>
              <td>{Number(item.hours)}</td><td>{(Number(item.hours) * Number(item.hourly_rate)).toFixed(2)} {item.currency}</td>
              <td>{contractStates[item.state]}{item.state === 'draft' && <p className="muted">Vous : {item.teacher_signed_at ? 'signé' : 'à signer'} · établissement : {item.institution_signed_at ? 'signé' : 'en attente'}</p>}</td>
              <td>{item.state === 'draft' && !item.teacher_signed_at && <ActionForm inline action={api + 'my-sign'} back={back} hidden={{ contractId: item.id }} submit="Signer le contrat" />}</td></tr>)}
          </Table>
        )}
      </Panel>
      <Panel title="Mes affectations et obligations" id="affectations">
        {data.assignments.length === 0 ? <p>Aucune affectation.</p> : <ul>{data.assignments.map(item => (
          <li key={item.id}><strong>{item.course}</strong> · {item.offering} · {functionLabels[item.function]} · {Number(item.hours)} h {item.state === 'ended' && <Badge tone="muted">terminée</Badge>}
            <ul>{item.obligations.map(obligation => <li key={obligation.id}>{obligation.label} — échéance {obligation.due_on} {obligation.done_at ? <Badge tone="ok">fait</Badge>
              : <ActionForm inline action={api + 'obligation-done'} back={back} hidden={{ obligationId: obligation.id }} submit="Marquer fait" />}</li>)}</ul></li>
        ))}</ul>}
      </Panel>
    </main>
  );
}
