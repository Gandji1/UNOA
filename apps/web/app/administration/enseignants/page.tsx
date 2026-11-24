import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { Problem } from '@/lib/shared/validation';
import { functionLabels, functions, teaContexts, teacherApplicationDetails, teaOverview } from '@/lib/teachers/store';
import { ActionForm, Badge, Editor, formatTime, Notice, Panel, Table } from '../forms';

export const metadata: Metadata = { title: 'Enseignants' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/enseignants';
const api = '/api/v1/tea/';
const states: Record<string, string> = { submitted: 'Déposée', review: 'En expertise', decided: 'Décidée', withdrawn: 'Retirée' };
const documentLabels: Record<string, string> = { diploma: 'Diplôme', cv: 'CV', reference: 'Référence', publication: 'Publication' };
const reviewLabels: Record<string, string> = { scientific: 'Expertise scientifique', pedagogical: 'Expertise pédagogique', interview: 'Entretien / démonstration' };
const contractStates: Record<string, [string, 'ok' | 'warn' | 'muted']> = { draft: ['À signer', 'warn'], signed: ['Signé', 'ok'], suspended: ['Suspendu', 'muted'], ended: ['Terminé', 'muted'] };

function refused(error: unknown) {
  if (error instanceof Problem) return null;
  throw error;
}

export default async function Enseignants({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const actor = await sessionAccount(settings, (await cookies()).get(cookieName(settings, 'session'))?.value).catch(() => null);
  if (!actor) redirect('/connexion');
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const denied = <main id="contenu" className="studio"><section className="studio-panel"><h1>Enseignants</h1>{notice}<p>Élément inaccessible.</p></section></main>;
  const crumbs = (...parts: [string, string?][]) => <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › <a href={path}>Enseignants</a>
    {parts.map(([label, href], index) => <span key={index}> › {href ? <a href={href}>{label}</a> : <span aria-current="page">{label}</span>}</span>)}</nav>;

  const applicationId = field(search.candidature);
  if (scopeIdFormat.test(applicationId)) {
    const data = await teacherApplicationDetails(settings, actor, applicationId).catch(refused);
    if (!data || data.own) return denied;
    const { application, rights } = data;
    const back = `${path}?candidature=${application.id}`;
    const profile = data.profile as Record<string, string | null> | null;
    const open = ['submitted', 'review'].includes(application.state);
    const hidden = { applicationId: application.id };
    return (
      <main id="contenu" className="studio">
        {crumbs([application.course_title])}
        <section className="studio-heading"><p className="eyebrow">{application.opening_title ?? 'Candidature spontanée'}</p><h1>{application.name ?? 'Candidat'}</h1>
          <p>{states[application.state]}{application.decision && <Badge tone={application.decision === 'accepted' ? 'ok' : 'danger'}>{application.decision === 'accepted' ? 'Retenu' : 'Non retenu'}</Badge>}
            {application.decision_reason && <span className="muted"> {application.decision_reason}</span>}</p></section>
        {notice}
        <Panel title="Profil et proposition" id="proposition">
          <section className="facts"><div><span>Discipline</span><strong>{profile?.discipline ?? '—'}</strong></div><div><span>Titre</span><strong>{profile?.title ?? '—'}</strong></div>
            <div><span>Cours proposé</span><strong>{application.course_title}</strong></div><div><span>Disponibilités</span><strong>{profile?.availability ?? '—'}</strong></div></section>
          <h3>Syllabus</h3><pre className="minutes">{application.syllabus}</pre>
          <h3>Proposition pédagogique</h3><pre className="minutes">{application.pedagogy}</pre>
          {profile?.publications && <><h3>Publications</h3><pre className="minutes">{profile.publications}</pre></>}
        </Panel>
        <Panel title="Pièces et qualifications" id="pieces">
          <Table label="Pièces" head={['Pièce', 'Fichier', 'Contrôle', '']}>
            {data.documents.map(item => <tr key={item.id}><td>{documentLabels[item.kind]}</td><td><a href={`${api}documents/${item.id}`}>{item.filename}</a></td>
              <td>{item.state === 'verified' ? <Badge tone="ok">Vérifiée</Badge> : item.state === 'deposited' ? <Badge tone="info">À contrôler</Badge>
                : <Badge tone="danger">{item.state === 'falsified' ? 'Falsifiée' : 'Rejetée'}</Badge>}{item.note && <span className="muted"> {item.note}</span>}</td>
              <td>{rights?.verify && item.state === 'deposited' && (
                <ActionForm inline action={api + 'verify'} back={back} hidden={{ ...hidden, documentId: item.id }} submit="Enregistrer">
                  <select name="state" aria-label="Contrôle"><option value="verified">Vérifiée</option><option value="rejected">Rejetée</option><option value="falsified">Falsifiée</option></select>
                  <input name="note" maxLength={500} placeholder="Observation" aria-label="Observation" />
                </ActionForm>
              )}</td></tr>)}
          </Table>
        </Panel>
        <Panel title="Expertises et entretien" id="expertises">
          {data.reviews.length === 0 ? <p>Aucun avis.</p> : <ul>{data.reviews.map((item, index) => <li key={index}><strong>{reviewLabels[item.kind]}</strong> — {item.recommendation} — {item.note}
            <span className="muted"> · {item.reviewer}{item.scheduled_at ? ' · ' + formatTime(item.scheduled_at) : ''}</span></li>)}</ul>}
          {rights?.review && open && (
            <Editor summary="Rendre un avis">
              <ActionForm action={api + 'review'} back={back} hidden={hidden} submit="Enregistrer l’avis" confirm="Les expertises scientifique et pédagogique sont rendues par deux personnes différentes.">
                <label>Nature<select name="kind">{Object.entries(reviewLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <label>Avis<select name="recommendation"><option value="favourable">Favorable</option><option value="reserved">Réservé</option><option value="unfavourable">Défavorable</option></select></label>
                <label>Date de l’entretien (facultative, UTC)<input name="scheduledAt" type="datetime-local" /></label>
                <label className="studio-wide">Avis motivé<textarea name="note" required maxLength={4000} /></label>
              </ActionForm>
            </Editor>
          )}
        </Panel>
        {rights?.decide && application.state === 'review' && (
          <Panel title="Décision collégiale" id="decision">
            <ActionForm action={api + 'decide'} back={back} hidden={hidden} submit="Décider" confirm="Exige les deux expertises et un diplôme vérifié ; la décision revient à une autre personne que les experts.">
              <label>Décision<select name="decision"><option value="accepted">Recruter</option><option value="rejected">Ne pas retenir</option></select></label>
              <label className="studio-wide">Motif<textarea name="reason" required maxLength={2000} /></label>
            </ActionForm>
          </Panel>
        )}
        {rights?.manage && application.decision === 'accepted' && (
          <Panel title="Contrat" id="contrat">
            <ActionForm action={api + 'contracts'} back={`${path}?scope=${application.scope_id}`} hidden={hidden} submit="Préparer le contrat">
              <label>Fonction<select name="function">{functions.map(item => <option key={item} value={item}>{functionLabels[item]}</option>)}</select></label>
              <label>Début<input name="startsOn" type="date" required /></label><label>Fin<input name="endsOn" type="date" required /></label>
              <label>Volume (heures)<input name="hours" type="number" min={1} step="0.5" required /></label>
              <label>Taux horaire<input name="hourlyRate" type="number" min={0} step="0.01" required /></label>
              <label>Monnaie<input name="currency" defaultValue="XOF" maxLength={3} pattern="[A-Z]{3}" /></label>
              <label className="studio-wide">Clauses<textarea name="terms" maxLength={6000} /></label>
            </ActionForm>
          </Panel>
        )}
      </main>
    );
  }

  const scopeId = field(search.scope);
  if (scopeIdFormat.test(scopeId)) {
    const data = await teaOverview(settings, actor, scopeId).catch(refused);
    if (!data) return denied;
    const back = `${path}?scope=${scopeId}`;
    return (
      <main id="contenu" className="studio">
        {crumbs([data.scope.label])}
        <section className="studio-heading"><p className="eyebrow">Enseignants</p><h1>{data.scope.label}</h1>
          <p>Appel → candidature → contrôle des pièces → expertises → décision → contrat signé par les deux parties → affectation → fin de mission.</p></section>
        {notice}
        <Panel title="Appels à candidatures" id="appels">
          {data.openings.length === 0 ? <p>Aucun appel.</p> : (
            <Table label="Appels" head={['Appel', 'Discipline', 'Niveau', 'Clôture', 'Candidatures', '']}>
              {data.openings.map(item => <tr key={item.id}><td>{item.title}</td><td>{item.discipline}</td><td>{item.level}</td><td>{formatTime(item.closes_at)}</td><td>{item.applications}</td>
                <td>{data.rights.manage && item.state === 'open' && <ActionForm inline action={api + 'close-opening'} back={back} hidden={{ openingId: item.id }} submit="Clore" />}</td></tr>)}
            </Table>
          )}
          {data.rights.manage && (
            <Editor summary="Publier un appel à candidatures">
              <ActionForm action={api + 'openings'} back={back} hidden={{ scopeId }} submit="Publier">
                <label className="studio-wide">Intitulé<input name="title" required maxLength={200} /></label>
                <label>Discipline<input name="discipline" required maxLength={200} /></label>
                <label>Niveau<input name="level" required maxLength={120} placeholder="ex. Licence 2" /></label>
                <label>Région (facultative)<input name="region" maxLength={120} /></label>
                <label>Clôture (UTC)<input name="closesAt" type="datetime-local" required /></label>
                <label className="studio-wide">Description<textarea name="description" required maxLength={6000} /></label>
              </ActionForm>
            </Editor>
          )}
        </Panel>
        <Panel title="Candidatures" id="candidatures">
          {data.applications.length === 0 ? <p>Aucune candidature déposée.</p> : (
            <Table label="Candidatures" head={['Candidat', 'Cours proposé', 'Appel', 'État']}>
              {data.applications.map(item => <tr key={item.id}><td><a href={`${path}?candidature=${item.id}`}>{item.name ?? '—'}</a></td><td>{item.course_title}</td>
                <td>{item.opening_title ?? 'Spontanée'}</td><td>{states[item.state] ?? item.state}{item.decision && ` · ${item.decision === 'accepted' ? 'retenu' : 'non retenu'}`}</td></tr>)}
            </Table>
          )}
        </Panel>
        <Panel title="Contrats et affectations" id="contrats" actions={data.rights.manage ? <a href={`${api}remuneration?scopeId=${scopeId}`}>Exporter les rémunérations (CSV)</a> : undefined}>
          {data.contracts.length === 0 ? <p>Aucun contrat.</p> : (
            <Table label="Contrats" head={['Enseignant', 'Fonction', 'Période', 'Heures (affectées)', 'Montant', 'État', '']}>
              {data.contracts.map(item => {
                const hidden = { contractId: item.id };
                return (
                  <tr key={item.id}><td>{item.name ?? '—'}</td><td>{functionLabels[item.function]}</td><td>{item.starts_on} → {item.ends_on}</td>
                    <td>{Number(item.hours)} ({Number(item.assigned_hours)})</td><td>{(Number(item.hours) * Number(item.hourly_rate)).toFixed(2)} {item.currency}</td>
                    <td><Badge tone={contractStates[item.state][1]}>{contractStates[item.state][0]}</Badge>
                      {item.state === 'draft' && <p className="muted">Enseignant : {item.teacher_signed_at ? 'signé' : 'en attente'} · établissement : {item.institution_signed_at ? 'signé' : 'en attente'}</p>}</td>
                    <td><div className="studio-actions">
                      {data.rights.decide && item.state === 'draft' && !item.institution_signed_at && <ActionForm inline action={api + 'sign'} back={back} hidden={hidden} submit="Signer pour l’établissement" />}
                      {data.rights.manage && item.state === 'signed' && data.offerings.length > 0 && (
                        <ActionForm inline action={api + 'assign'} back={back} hidden={hidden} submit="Affecter">
                          <select name="offeringId" aria-label="Offre de cours">{data.offerings.map(offering => <option key={offering.id} value={offering.id}>{offering.title} · {offering.label}</option>)}</select>
                          <select name="function" defaultValue={item.function} aria-label="Fonction">{functions.map(fn => <option key={fn} value={fn}>{functionLabels[fn]}</option>)}</select>
                          <input name="hours" type="number" min={1} step="0.5" required placeholder="Heures" aria-label="Heures" />
                        </ActionForm>
                      )}
                      {data.rights.manage && item.state === 'signed' && <ActionForm inline action={api + 'suspend'} back={back} hidden={hidden} submit="Suspendre">
                        <input name="reason" required maxLength={1000} placeholder="Motif" aria-label="Motif de suspension" /></ActionForm>}
                      {data.rights.manage && item.state === 'suspended' && <ActionForm inline action={api + 'resume'} back={back} hidden={hidden} submit="Reprendre">
                        <input name="reason" required maxLength={1000} placeholder="Motif" aria-label="Motif de reprise" /></ActionForm>}
                      {data.rights.manage && item.state !== 'ended' && <ActionForm inline action={api + 'end'} back={back} hidden={hidden} submit="Mettre fin">
                        <input name="reason" required maxLength={1000} placeholder="Motif" aria-label="Motif de fin" /></ActionForm>}
                      {data.rights.manage && ['signed', 'ended'].includes(item.state) && <ActionForm inline action={api + 'renew'} back={back} hidden={hidden} submit="Renouveler">
                        <input name="startsOn" type="date" required aria-label="Début du renouvellement" /><input name="endsOn" type="date" required aria-label="Fin du renouvellement" /></ActionForm>}
                    </div></td></tr>
                );
              })}
            </Table>
          )}
        </Panel>
      </main>
    );
  }

  const scopes = await teaContexts(settings, actor);
  return (
    <main id="contenu" className="studio">
      {crumbs()}
      <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Enseignants</h1><p>Choisissez un établissement, une faculté ou un département.</p></section>
      {notice}
      {scopes.length === 0 ? <p className="card-note">Aucun périmètre accessible.</p> : (
        <ul className="program-grid">{scopes.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>
      )}
    </main>
  );
}
