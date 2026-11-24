import type { Metadata } from 'next';
import { kindLabels } from '@unoa/domain/assessment';
import { assessmentKindLabels, offeringAssessments } from '@/lib/assessments/store';
import { ActionForm, Badge, Editor, formatTime, Notice, Panel, Table } from '../../administration/forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Gestion des évaluations' };
export const dynamic = 'force-dynamic';

const api = '/api/v1/ass/';
const states: Record<string, [string, 'ok' | 'warn' | 'muted' | 'info']> = { draft: ['Brouillon', 'warn'], published: ['Publiée', 'ok'], closed: ['Close', 'muted'] };
const rounds: Record<string, string> = { first: '1re correction', second: '2e correction', moderation: 'Modération' };
const caseStates: Record<string, string> = { open: 'En attente des observations', answered: 'Observations reçues', dismissed: 'Classée', sanctioned: 'Sanction' };

export default async function Gestion({ searchParams }: { searchParams: Promise<{ offre?: string; error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = search.offre ? await offeringAssessments(settings, actor, search.offre).catch(refusedAs(null)) : null;
  if (!data) {
    return (
      <main id="contenu" className="studio">
        <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/evaluations">Mes évaluations</a> › <span aria-current="page">Gestion</span></nav>
        <section className="studio-heading"><h1>Gestion des évaluations</h1></section>
        <p className="studio-notice" role="alert">Choisissez un cours depuis « Mes évaluations » : cette offre est introuvable ou hors de vos habilitations.</p>
      </main>
    );
  }
  const back = `/evaluations/gestion?offre=${data.access.offeringId}`;
  const hidden = { offeringId: data.access.offeringId };
  const can = data.access;
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/evaluations">Mes évaluations</a> › <span aria-current="page">{data.access.course}</span></nav>
      <section className="studio-heading"><p className="eyebrow">{data.access.label} · fuseau {data.access.timeZone}</p><h1>Évaluations — {data.access.course}</h1>
        <p>Banques de questions versionnées, épreuves avec fenêtre, durée, tentatives et tirage, aménagements, correction, double correction, modération et procédure de fraude.</p></section>
      <Notice error={search.error} message={search.message} />

      <Panel title="Banques de questions" id="banques">
        {can.author && (
          <ActionForm action={api + 'banks'} back={back} hidden={hidden} submit="Créer la banque">
            <label>Titre de la banque<input name="title" required maxLength={200} /></label>
          </ActionForm>
        )}
        {data.banks.length === 0 ? <p>Aucune banque.</p> : data.banks.map(bank => {
          const questions = data.questions.filter(item => item.bank_id === bank.id);
          return (
            <section key={bank.id} className="studio-panel"><h3>{bank.title} <Badge tone="muted">{questions.length} question(s)</Badge></h3>
              {questions.length > 0 && (
                <Table label={'Questions de ' + bank.title} head={['Énoncé', 'Type', 'Points', 'Version', '']}>
                  {questions.map(item => <tr key={item.id}><td>{item.prompt}{item.choices.length > 0 && <p className="muted">{item.choices.join(' · ')}</p>}</td>
                    <td>{kindLabels[item.kind]}</td><td>{Number(item.points)}</td><td>v{item.version}</td>
                    <td>{can.author && <>
                      <Editor summary="Nouvelle version">
                        <ActionForm action={api + 'revise'} back={back} hidden={{ ...hidden, questionId: item.id }} submit="Enregistrer la version">
                          <label className="studio-wide">Énoncé<textarea name="prompt" required maxLength={6000} defaultValue={item.prompt} /></label>
                          <label className="studio-wide">Réponses<textarea name="source" rows={4} defaultValue={sourceOf(item.kind, item.choices, item.answer)} /></label>
                          <label>Points<input name="points" required inputMode="decimal" defaultValue={Number(item.points)} /></label>
                        </ActionForm>
                      </Editor>
                      <ActionForm inline action={api + 'retire'} back={back} hidden={{ ...hidden, questionId: item.id }} submit="Retirer" />
                    </>}</td></tr>)}
                </Table>
              )}
              {can.author && (
                <Editor summary="Ajouter une question">
                  <ActionForm action={api + 'questions'} back={back} hidden={{ ...hidden, bankId: bank.id }} submit="Ajouter la question">
                    <label>Type<select name="kind">{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label>Points<input name="points" required inputMode="decimal" defaultValue="1" /></label>
                    <label className="studio-wide">Énoncé<textarea name="prompt" required maxLength={6000} /></label>
                    <label className="studio-wide">Réponses<textarea name="source" rows={4} /></label>
                    <p className="studio-wide studio-help">Choix : une ligne par choix, bonne(s) réponse(s) précédée(s) de « * ». Appariement : « gauche = droite » par ligne.
                      Calcul : « valeur » ou « valeur ± tolérance ». Réponse rédigée, code et fichier : laisser vide (correction humaine).</p>
                    <label className="studio-wide">Mots-clés<input name="tags" maxLength={200} /></label>
                  </ActionForm>
                </Editor>
              )}
            </section>
          );
        })}
      </Panel>

      <Panel title="Épreuves" id="epreuves">
        {can.author && (
          <Editor summary="Créer une épreuve">
            <ActionForm action={api + 'assessments'} back={back} hidden={hidden} submit="Créer l’épreuve">
              <label>Titre<input name="title" required maxLength={200} /></label>
              <label>Type<select name="kind">{Object.entries(assessmentKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Ouverture (UTC)<input type="datetime-local" name="opensAt" required /></label>
              <label>Fermeture (UTC)<input type="datetime-local" name="closesAt" required /></label>
              <label>Durée en minutes<input name="durationMinutes" inputMode="numeric" /></label>
              <label>Tentatives<input name="attemptsAllowed" inputMode="numeric" defaultValue="1" /></label>
              <label>Tirage (nombre de questions)<input name="drawCount" inputMode="numeric" /></label>
              <label className="studio-check"><input type="checkbox" name="team" /> Travail en équipe</label>
              <label className="studio-check"><input type="checkbox" name="doubleGrading" /> Double correction</label>
              <label className="studio-wide">Consignes<textarea name="instructions" maxLength={6000} /></label>
              <label className="studio-wide">Grille de critères (« critère : points » par ligne)<textarea name="rubric" rows={3} /></label>
            </ActionForm>
          </Editor>
        )}
        {data.assessments.length === 0 ? <p>Aucune épreuve.</p> : data.assessments.map(item => {
          const subject = data.subject.filter(link => link.assessment_id === item.id);
          const copies = data.copies.filter(copy => copy.assessment_id === item.id);
          const available = data.questions.filter(question => !subject.some(link => link.question_id === question.id));
          return (
            <section key={item.id} className="studio-panel">
              <h3>{item.title} <Badge tone={states[item.state][1]}>{states[item.state][0]}</Badge> <Badge tone="info">{assessmentKindLabels[item.kind]}</Badge>
                {item.team && <> <Badge tone="muted">En équipe</Badge></>}{item.double_grading && <> <Badge tone="muted">Double correction</Badge></>}</h3>
              <p className="muted">{formatTime(item.opens_at)} → {formatTime(item.closes_at)}{item.duration_minutes ? ` · ${item.duration_minutes} min` : ''} · {item.attempts_allowed} tentative(s)
                {item.draw_count ? ` · tirage de ${item.draw_count} question(s)` : ''}{item.rubric.length ? ' · grille : ' + item.rubric.map(row => `${row.criterion} (${row.points})`).join(', ') : ''}</p>
              <h4>Sujet ({subject.length} question(s))</h4>
              <ol>{subject.map(link => <li key={link.question_id}>{link.prompt} <span className="muted">— {kindLabels[link.kind as keyof typeof kindLabels]}, {Number(link.points)} pt, v{link.version}</span>
                {can.author && item.state === 'draft' && <ActionForm inline action={api + 'remove-question'} back={back} hidden={{ ...hidden, assessmentId: item.id, questionId: link.question_id }} submit="Retirer du sujet" />}</li>)}</ol>
              {can.author && item.state === 'draft' && available.length > 0 && (
                <ActionForm inline action={api + 'add-question'} back={back} hidden={{ ...hidden, assessmentId: item.id }} submit="Ajouter au sujet">
                  <label>Question<select name="questionId">{available.map(question => <option key={question.id} value={question.id}>{question.prompt.slice(0, 80)}</option>)}</select></label>
                </ActionForm>
              )}
              {can.author && <div className="studio-actions">
                {item.state === 'draft' && <ActionForm inline action={api + 'publish'} back={back} hidden={{ ...hidden, assessmentId: item.id }} submit="Publier (le sujet sera figé)" />}
                {item.state === 'published' && <ActionForm inline action={api + 'close'} back={back} hidden={{ ...hidden, assessmentId: item.id }} submit="Clore" />}
                <a className="secondary" href={`${api}archive/${item.id}`}>Archive des copies (JSON scellé)</a>
              </div>}
              {can.author && (
                <Editor summary="Aménagement pour un apprenant">
                  <ActionForm action={api + 'accommodations'} back={back} hidden={{ ...hidden, assessmentId: item.id }} submit="Enregistrer l’aménagement">
                    <label>Apprenant<select name="accountId">{data.learners.map(person => <option key={person.account_id} value={person.account_id}>{person.name ?? person.account_id.slice(0, 8)}</option>)}</select></label>
                    <label>Minutes supplémentaires<input name="extraMinutes" inputMode="numeric" /></label>
                    <label>Jours supplémentaires<input name="extraDays" inputMode="numeric" /></label>
                    <label className="studio-wide">Justification documentée<textarea name="reason" required maxLength={1000} /></label>
                  </ActionForm>
                </Editor>
              )}
              {data.accommodations.filter(row => row.assessment_id === item.id).map(row => <p key={row.name} className="muted">Aménagement : {row.name} · +{row.extra_minutes} min · +{row.extra_days} j — {row.reason}</p>)}
              <h4>Copies soumises ({copies.length})</h4>
              {copies.length > 0 && (
                <Table label={'Copies de ' + item.title} head={['Apprenant', 'Soumise', 'Accusé', 'Auto', 'Corrections', '']}>
                  {copies.map(copy => <tr key={copy.id}><td>{copy.name}{copy.team_label ? ' · ' + copy.team_label : ''}</td><td>{formatTime(copy.submitted_at)}</td>
                    <td><code>{copy.receipt.slice(0, 12)}</code></td><td>{copy.auto_score ?? '—'}</td>
                    <td>{copy.rounds.map(name => rounds[name]).join(', ') || 'À corriger'}{copy.open_cases > 0 && <> <Badge tone="danger">procédure</Badge></>}</td>
                    <td><a href={`/evaluations/copie?id=${copy.id}`}>Ouvrir la copie</a></td></tr>)}
                </Table>
              )}
            </section>
          );
        })}
      </Panel>

      <Panel title="Suspicions de fraude ou de plagiat" id="fraude">
        {data.cases.length === 0 ? <p>Aucune procédure.</p> : (
          <Table label="Procédures" head={['Épreuve', 'Apprenant', 'Motif', 'Observations', 'État', '']}>
            {data.cases.map(item => <tr key={item.id}><td>{item.title}</td><td>{item.name}</td><td>{item.reason}</td><td>{item.learner_response ?? '—'}</td>
              <td>{caseStates[item.state]}{item.decision ? ' — ' + item.decision : ''}</td><td><a href={`/evaluations/copie?id=${item.attempt_id}`}>Copie</a></td></tr>)}
          </Table>
        )}
      </Panel>
    </main>
  );
}

function sourceOf(kind: string, choices: string[], answer: unknown) {
  if (kind === 'single' || kind === 'multiple') return choices.map((choice, index) => ((answer as number[]).includes(index) ? '*' : '') + choice).join('\n');
  if (kind === 'matching') return choices.map((left, index) => `${left} = ${(answer as string[])[index]}`).join('\n');
  if (kind === 'numeric') { const value = answer as { value: number; tolerance: number }; return value.tolerance ? `${value.value} ± ${value.tolerance}` : String(value.value); }
  return '';
}
