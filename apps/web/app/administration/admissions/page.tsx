import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { Problem } from '@/lib/shared/validation';
import { admissionsContexts, admissionsOverview, applicationView, decisions, roundDetails } from '@/lib/admissions/store';
import { ActionForm, Badge, Editor, formatTime, Notice, Panel, Table } from '../forms';
import { applicationStates, decisionLabels, documentStates } from '../../candidature/labels';

export const metadata: Metadata = { title: 'Admissions' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/admissions';
const api = '/api/v1/admissions/';
const roundStates: Record<string, [string, 'ok' | 'warn' | 'muted']> = { draft: ['Brouillon', 'warn'], open: ['Ouverte', 'ok'], closed: ['Close', 'muted'] };
const State = ({ state }: { state: string }) => <Badge tone={applicationStates[state][1]}>{applicationStates[state][0]}</Badge>;
const recommendations: Record<string, string> = { favourable: 'Favorable', reserved: 'Réservé', unfavourable: 'Défavorable' };

function refused(error: unknown) {
  if (error instanceof Problem) return null;
  throw error;
}

export default async function Admissions({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const actor = await sessionAccount(settings, (await cookies()).get(cookieName(settings, 'session'))?.value).catch(() => null);
  if (!actor) redirect('/connexion');
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const denied = <main id="contenu" className="studio"><section className="studio-panel"><h1>Admissions</h1>{notice}
    <p>Élément inaccessible avec vos habilitations.</p><p><a href={path}>Revenir aux admissions</a></p></section></main>;
  const crumbs = (...parts: [string, string?][]) => (
    <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <a href={path}>Admissions</a>
      {parts.map(([label, href], index) => <span key={index}> › {href ? <a href={href}>{label}</a> : <span aria-current="page">{label}</span>}</span>)}</nav>
  );

  // ------------------------------------------------------------ application
  const applicationId = field(search.application);
  if (scopeIdFormat.test(applicationId)) {
    const view = await applicationView(settings, actor, applicationId).catch(refused);
    if (!view || !view.staff) return denied;
    const { application, round, rights } = view;
    const back = `${path}?application=${application.id}`;
    const action = `${api}applications/${application.id}/`;
    const open = ['submitted', 'review'].includes(application.state);
    return (
      <main id="contenu" className="studio">
        {crumbs([round.label, `${path}?round=${round.id}`], [application.receipt ?? 'Dossier'])}
        <section className="studio-heading"><p className="eyebrow">{round.program_code} · {round.label}</p>
          <h1>Dossier {application.receipt}</h1>
          <p><State state={application.state} />{application.decision && <Badge tone="info">{decisionLabels[application.decision]}</Badge>}
            <span className="muted"> Déposé le {formatTime(application.submitted_at)} · version {application.revision}</span></p></section>
        {notice}
        <Panel title="Réponses du candidat" id="reponses">
          <section className="facts">{round.form.map(item => <div key={item.key}><span>{item.label}</span><strong>{application.answers[item.key] || '—'}</strong></div>)}</section>
        </Panel>
        <Panel title="Contrôle des pièces" id="pieces">
          <Table label="Pièces" head={['Pièce', 'Fichier', 'Empreinte', 'État', 'Contrôle']}>
            {view.documents.map(doc => (
              <tr key={doc.id}>
                <td>{round.documents.find(rule => rule.key === doc.document_key)?.label ?? doc.document_key}</td>
                <td><a href={`/api/v1/admissions-documents/${doc.id}`}>{doc.filename}</a> ({Math.ceil(doc.size_bytes / 1024)} Ko)</td>
                <td><code>{doc.sha256.slice(0, 16)}…</code></td>
                <td><Badge tone={documentStates[doc.state][1]}>{documentStates[doc.state][0]}</Badge>{doc.note && <span className="muted"> {doc.note}</span>}</td>
                <td>{rights?.review && (
                  <ActionForm inline action={action + 'document'} back={back} hidden={{ documentId: doc.id }} submit="Enregistrer">
                    <select name="state" aria-label="Contrôle"><option value="verified">Vérifiée</option><option value="rejected">Rejetée</option></select>
                    <input name="note" aria-label="Observation" placeholder="Observation" maxLength={500} />
                  </ActionForm>
                )}</td>
              </tr>
            ))}
          </Table>
          {view.history.length > 0 && <p className="muted">{view.history.length} version(s) antérieure(s) conservée(s).</p>}
        </Panel>
        <Panel title="Instruction" id="instruction">
          {view.reviews.length === 0 ? <p>Aucun avis.</p> : (
            <Table label="Avis" head={['Nature', 'Score', 'Avis', 'Observation', 'Date']}>
              {view.reviews.map(item => (
                <tr key={item.id}><td>{item.kind === 'academic' ? 'Académique' : 'Administrative'}</td>
                  <td>{item.score === null ? '—' : Number(item.score).toFixed(1) + ' / 100'}</td>
                  <td>{recommendations[item.recommendation]}</td><td>{item.note}</td><td>{formatTime(item.created_at)}</td></tr>
              ))}
            </Table>
          )}
          {rights?.review && open && <>
            <Editor summary="Instruction administrative">
              <ActionForm action={action + 'review'} back={back} hidden={{ kind: 'administrative' }} submit="Enregistrer l’avis">
                <label>Avis<select name="recommendation"><option value="favourable">Favorable</option><option value="reserved">Réservé</option><option value="unfavourable">Défavorable</option></select></label>
                <label className="studio-wide">Observation<textarea name="note" required maxLength={2000} /></label>
              </ActionForm>
            </Editor>
            {round.criteria.length > 0 && <Editor summary="Évaluation académique (grille)">
              <ActionForm action={action + 'review'} back={back} hidden={{ kind: 'academic' }} submit="Enregistrer l’évaluation">
                {round.criteria.map(item => <label key={item.key}>{item.label} (/{item.max}, poids {item.weight})
                  <input type="number" name={'score_' + item.key} min={0} max={item.max} step="0.25" required /></label>)}
                <label>Avis<select name="recommendation"><option value="favourable">Favorable</option><option value="reserved">Réservé</option><option value="unfavourable">Défavorable</option></select></label>
                <label className="studio-wide">Observation<textarea name="note" required maxLength={2000} /></label>
              </ActionForm>
            </Editor>}
            <Editor summary="Demander un complément">
              <ActionForm action={action + 'request'} back={back} submit="Envoyer la demande">
                <label className="studio-wide">Demande<textarea name="message" required maxLength={2000} /></label>
              </ActionForm>
            </Editor>
            <Editor summary="Convoquer (entretien, test)">
              <ActionForm action={action + 'interview'} back={back} submit="Convoquer">
                <label>Nature<input name="kind" required maxLength={120} /></label>
                <label>Date et heure (UTC)<input name="scheduledAt" type="datetime-local" required /></label>
                <label className="studio-wide">Lieu ou lien<input name="place" required maxLength={500} /></label>
              </ActionForm>
            </Editor>
          </>}
          {view.requests.length > 0 && <ul>{view.requests.map(item => <li key={item.id}>{formatTime(item.requested_at)} — {item.message} {item.answered_at ? '(traitée)' : '(en attente)'}</li>)}</ul>}
          {view.interviews.length > 0 && <ul>{view.interviews.map(item => <li key={item.id}>{item.kind} — {formatTime(item.scheduled_at)} — {item.place}</li>)}</ul>}
        </Panel>
        <Panel title="Décision" id="decision">
          {view.decisions.length > 0 && <ul>{view.decisions.map(item => <li key={item.id}><strong>{decisionLabels[item.decision]}</strong> — {formatTime(item.decided_at)} — {item.reason}{item.conditions && ' · Conditions : ' + item.conditions}</li>)}</ul>}
          {rights?.decide && open && (
            <ActionForm action={action + 'decide'} back={back} submit="Rendre la décision" confirm="La décision suit au moins un avis d’instruction ; elle est notifiée au candidat et conservée.">
              <label>Décision<select name="decision">{decisions.map(item => <option key={item} value={item}>{decisionLabels[item]}</option>)}</select></label>
              <label className="studio-wide">Motif<textarea name="reason" required maxLength={2000} /></label>
              <label className="studio-wide">Conditions (admission conditionnelle)<textarea name="conditions" maxLength={2000} /></label>
            </ActionForm>
          )}
        </Panel>
        {view.appeals.length > 0 && <Panel title="Recours" id="recours">
          <ul>{view.appeals.map(item => <li key={item.id}>{formatTime(item.filed_at)} — {item.reason} — {item.state}{item.ruling && ' : ' + item.ruling}</li>)}</ul>
          {rights?.appeal && view.appeals.some(item => item.state === 'submitted') && (
            <ActionForm action={action + 'rule'} back={back} submit="Statuer" confirm="Le recours est tranché par une personne autre que l’auteur de la décision.">
              <label>Décision<select name="ruling"><option value="upheld">Maintenir</option><option value="granted">Accueillir (réexamen)</option></select></label>
              <label className="studio-wide">Motif<textarea name="note" required maxLength={2000} /></label>
            </ActionForm>
          )}
        </Panel>}
      </main>
    );
  }

  // ------------------------------------------------------------------ round
  const roundId = field(search.round);
  if (scopeIdFormat.test(roundId)) {
    const filter = field(search.state);
    const data = await roundDetails(settings, actor, roundId, filter in applicationStates ? filter : undefined).catch(refused);
    if (!data) return denied;
    const { round, rights, applications } = data;
    const back = `${path}?round=${round.id}`;
    return (
      <main id="contenu" className="studio">
        {crumbs([round.owner_label, `${path}?scope=${round.owner_scope_id}`], [round.label])}
        <section className="studio-heading"><p className="eyebrow">{round.program_code} · {round.program_title}</p><h1>{round.label}</h1>
          <p><Badge tone={roundStates[round.state][1]}>{roundStates[round.state][0]}</Badge>
            <span className="muted"> {formatTime(round.opens_at)} → {formatTime(round.closes_at)}</span></p></section>
        {notice}
        {rights?.manage && <div className="studio-actions">
          {round.state === 'draft' && <ActionForm inline action={`${api}rounds/${round.id}/open`} back={back} submit="Ouvrir la campagne" />}
          {round.state === 'open' && <ActionForm inline action={`${api}rounds/${round.id}/close`} back={back} submit="Clore la campagne" />}
        </div>}
        <Panel title="Règles de la campagne" id="regles">
          <Table label="Formulaire" head={['Clé', 'Champ', 'Type', 'Obligatoire']}>
            {round.form.map(item => <tr key={item.key}><td><code>{item.key}</code></td><td>{item.label}</td><td>{item.type}{item.choices.length ? ' : ' + item.choices.join(', ') : ''}</td><td>{item.required ? 'oui' : 'non'}</td></tr>)}
          </Table>
          <Table label="Pièces" head={['Clé', 'Pièce', 'Formats', 'Taille', 'Obligatoire']}>
            {round.documents.map(item => <tr key={item.key}><td><code>{item.key}</code></td><td>{item.label}</td><td>{item.formats.join(', ')}</td><td>{item.maxKb} Ko</td><td>{item.required ? 'oui' : 'non'}</td></tr>)}
          </Table>
          <Table label="Grille de sélection" head={['Clé', 'Critère', 'Poids', 'Barème']}>
            {round.criteria.map(item => <tr key={item.key}><td><code>{item.key}</code></td><td>{item.label}</td><td>{item.weight}</td><td>/{item.max}</td></tr>)}
          </Table>
        </Panel>
        <Panel title="Dossiers" id="dossiers" actions={
          <form method="get" action={path} className="studio-inline"><input type="hidden" name="round" value={round.id} />
            <select name="state" defaultValue={filter} aria-label="Filtrer par état"><option value="">Tous les états</option>
              {Object.entries(applicationStates).filter(([key]) => key !== 'draft').map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}</select>
            <button className="secondary" type="submit">Filtrer</button></form>}>
          {applications.length === 0 ? <p>Aucun dossier déposé.</p> : (
            <Table label="Dossiers" head={['Accusé', 'Candidat', 'Dépôt', 'État', 'Score moyen']}>
              {applications.map(item => (
                <tr key={item.id}><td><a href={`${path}?application=${item.id}`}>{item.receipt ?? '—'}</a></td><td>{item.applicant ?? '—'}</td>
                  <td>{formatTime(item.submitted_at)}</td><td><State state={item.state} />{item.decision && ' ' + decisionLabels[item.decision]}</td>
                  <td>{item.score === null ? '—' : Number(item.score).toFixed(1)}</td></tr>
              ))}
            </Table>
          )}
        </Panel>
      </main>
    );
  }

  // ------------------------------------------------------------------ scope
  const scopeId = field(search.scope);
  if (scopeIdFormat.test(scopeId)) {
    const data = await admissionsOverview(settings, actor, scopeId).catch(refused);
    if (!data) return denied;
    const back = `${path}?scope=${scopeId}`;
    const eligible = data.versions.filter(item => item.admission_open && item.allowed);
    return (
      <main id="contenu" className="studio">
        {crumbs([data.scope.label])}
        <section className="studio-heading"><p className="eyebrow">Admissions</p><h1>{data.scope.label}</h1>
          <p>Campagnes, formulaires et grilles définis par l’établissement ; instruction, décisions et recours tracés.</p></section>
        {notice}
        <Panel title="Campagnes" id="campagnes">
          {data.rounds.length === 0 ? <p>Aucune campagne.</p> : (
            <Table label="Campagnes" head={['Campagne', 'Formation', 'Période', 'État', 'Dossiers']}>
              {data.rounds.map(item => (
                <tr key={item.id}><td><a href={`${path}?round=${item.id}`}>{item.label}</a></td><td>{item.program_code}</td>
                  <td>{formatTime(item.opens_at)} → {formatTime(item.closes_at)}</td>
                  <td><Badge tone={roundStates[item.state][1]}>{roundStates[item.state][0]}</Badge></td>
                  <td>{Object.entries(item.counts).map(([state, total]) => `${applicationStates[state]?.[0] ?? state} : ${total}`).join(' · ') || '0'}</td></tr>
              ))}
            </Table>
          )}
        </Panel>
        {data.rights.manage && (
          <Editor summary="Nouvelle campagne">
            {eligible.length === 0 ? <p>Aucune version publiée ouverte aux candidatures avec une autorisation vérifiée.</p> : (
              <ActionForm action={`${api}rounds`} back={back} submit="Créer la campagne (brouillon)">
                <label>Formation<select name="versionId" required>{eligible.map(item => <option key={item.id} value={item.id}>{item.code} — {item.title} (v{item.number})</option>)}</select></label>
                <label>Intitulé<input name="label" required maxLength={200} /></label>
                <label>Ouverture (UTC)<input name="opensAt" type="datetime-local" required /></label>
                <label>Clôture (UTC)<input name="closesAt" type="datetime-local" required /></label>
                <label className="studio-wide">Formulaire — une ligne par champ : <code>clé | libellé | text, textarea, email, date, number ou choice | obligatoire | choix1 ; choix2</code>
                  <textarea name="form" required rows={6} /></label>
                <label className="studio-wide">Pièces — <code>clé | libellé | pdf,jpg,png | taille max. en Ko | obligatoire</code><textarea name="documents" rows={4} /></label>
                <label className="studio-wide">Grille de sélection — <code>clé | critère | poids | barème</code><textarea name="criteria" rows={4} /></label>
                <label className="studio-wide">Consignes publiées<textarea name="instructions" maxLength={4000} /></label>
              </ActionForm>
            )}
          </Editor>
        )}
      </main>
    );
  }

  const scopes = await admissionsContexts(settings, actor);
  return (
    <main id="contenu" className="studio">
      {crumbs()}
      <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Admissions</h1><p>Choisissez une structure.</p></section>
      {notice}
      {scopes.length === 0 ? <p className="card-note">Aucune structure accessible pour les admissions.</p> : (
        <ul className="program-grid">{scopes.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>
      )}
    </main>
  );
}
