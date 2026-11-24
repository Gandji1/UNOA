import type { Metadata } from 'next';
import { autoKinds, kindLabels } from '@unoa/domain/assessment';
import { copyDetails } from '@/lib/assessments/store';
import { ActionForm, Badge, formatTime, Hidden, Notice, Panel, Table } from '../../administration/forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Copie' };
export const dynamic = 'force-dynamic';

const api = '/api/v1/ass/';
const rounds: Record<string, string> = { first: 'Première correction', second: 'Seconde correction', moderation: 'Modération' };
const caseStates: Record<string, string> = { open: 'En attente de vos observations', answered: 'Observations transmises', dismissed: 'Classée sans suite', sanctioned: 'Sanction prononcée' };

const shown = (value: unknown, choices: string[]) => {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.map(item => typeof item === 'number' && choices[item] !== undefined ? choices[item] : String(item)).join(' · ');
  return typeof value === 'number' || /^\d+$/.test(String(value)) ? choices[Number(value)] ?? String(value) : String(value);
};

export default async function Copie({ searchParams }: { searchParams: Promise<{ id?: string; error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = search.id ? await copyDetails(settings, actor, search.id).catch(refusedAs(null)) : null;
  if (!data) {
    return (
      <main id="contenu" className="studio">
        <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/evaluations">Mes évaluations</a> › <span aria-current="page">Copie</span></nav>
        <section className="studio-heading"><h1>Copie</h1></section>
        <p className="studio-notice" role="alert">Copie introuvable ou inaccessible.</p>
      </main>
    );
  }
  const { attempt, assessment, subject } = data;
  const back = `/evaluations/copie?id=${attempt.id}`;
  const editing = data.own && attempt.state === 'in_progress';
  const answers = attempt.answers as Record<string, unknown>;
  const manual = subject.filter(item => !autoKinds.includes(item.kind));
  const grading = data.staff && attempt.state === 'submitted' && data.pending && (data.pending === 'moderation' ? data.access.moderate : data.access.grade);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/evaluations">Mes évaluations</a>{data.staff && <> › <a href={`/evaluations/gestion?offre=${assessment.offering_id}`}>{data.access.course}</a></>} › <span aria-current="page">Copie</span></nav>
      <section className="studio-heading"><p className="eyebrow">{data.access.course} · tentative {attempt.number}{attempt.team_label ? ' · équipe ' + attempt.team_label : ''}</p>
        <h1>{assessment.title}</h1>
        {data.staff && <p>Copie de {attempt.name}</p>}
        {assessment.instructions && <p>{assessment.instructions}</p>}</section>
      <Notice error={search.error} message={search.message} />
      <Panel title="État de la copie" id="etat">
        <ul>
          <li>Commencée le {formatTime(attempt.started_at)} · à rendre avant le {formatTime(attempt.deadline)}</li>
          {attempt.saved_at && <li>Dernier enregistrement : {formatTime(attempt.saved_at)}</li>}
          {attempt.state === 'submitted'
            ? <li><Badge tone="ok">Soumise</Badge> le {formatTime(attempt.submitted_at)} — accusé de réception <code>{attempt.receipt}</code></li>
            : <li><Badge tone="warn">En cours</Badge> — enregistrez votre brouillon régulièrement.</li>}
          {attempt.state === 'submitted' && <li>Note : {data.sanctioned ? <Badge tone="danger">0 (sanction)</Badge> : data.underReview ? 'en attente (procédure en cours)'
            : data.mark !== null ? <strong>{data.mark} / {data.maximum}</strong> : 'correction en cours'}</li>}
        </ul>
      </Panel>

      {editing ? (
        <Panel title="Mes réponses" id="reponses">
          <form method="post" action={api + 'save'} className="studio-form">
            <Hidden values={{ return: back, attemptId: attempt.id, answersForm: '1' }} />
            {subject.map((question, index) => (
              <fieldset key={question.id} className="studio-wide">
                <legend>Question {index + 1} · {question.points} pt · {kindLabels[question.kind]}</legend>
                <p>{question.prompt}</p>
                {question.kind === 'single' && question.choices.map((choice, position) => (
                  <label key={position} className="studio-check"><input type="radio" name={`q.${question.id}`} value={position} defaultChecked={String(answers[question.id]) === String(position)} /> {choice}</label>))}
                {question.kind === 'multiple' && question.choices.map((choice, position) => (
                  <label key={position} className="studio-check"><input type="checkbox" name={`q.${question.id}.${position}`} defaultChecked={Array.isArray(answers[question.id]) && (answers[question.id] as number[]).map(Number).includes(position)} /> {choice}</label>))}
                {question.kind === 'matching' && question.choices.map((left, position) => (
                  <label key={position}>{left}<select name={`q.${question.id}.${position}`} defaultValue={Array.isArray(answers[question.id]) ? String((answers[question.id] as string[])[position] ?? '') : ''}>
                    <option value="">—</option>{(question.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}</select></label>))}
                {question.kind === 'numeric' && <label>Valeur<input name={`q.${question.id}`} inputMode="decimal" defaultValue={String(answers[question.id] ?? '')} /></label>}
                {question.kind === 'text' && <label className="studio-wide">Réponse<textarea name={`q.${question.id}`} rows={6} defaultValue={String(answers[question.id] ?? '')} /></label>}
                {question.kind === 'code' && <label className="studio-wide">Code<textarea name={`q.${question.id}`} rows={8} spellCheck={false} className="code" defaultValue={String(answers[question.id] ?? '')} /></label>}
                {question.kind === 'file' && <p className="muted">{data.files.filter(file => file.question_id === question.id).map(file => `${file.filename} (empreinte ${file.sha256.slice(0, 12)})`).join(', ') || 'Aucun fichier déposé.'} Déposez le fichier ci-dessous.</p>}
              </fieldset>
            ))}
            <div className="studio-wide studio-actions">
              <button className="secondary" type="submit">Enregistrer le brouillon</button>
              <button className="action" type="submit" formAction={api + 'submit'}>Soumettre définitivement</button>
            </div>
          </form>
          {subject.filter(question => question.kind === 'file').map(question => (
            <form key={question.id} method="post" action={api + 'files'} encType="multipart/form-data" className="studio-inline">
              <Hidden values={{ return: back, attemptId: attempt.id, questionId: question.id }} />
              <input type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg" aria-label={'Fichier pour : ' + question.prompt.slice(0, 60)} />
              <button className="secondary" type="submit">Déposer le fichier</button>
            </form>
          ))}
        </Panel>
      ) : (
        <Panel title="Réponses" id="reponses">
          <Table label="Réponses de la copie" head={data.staff ? ['Question', 'Réponse', 'Attendu', 'Auto', 'Barème'] : ['Question', 'Réponse', 'Auto', 'Barème']}>
            {subject.map(question => <tr key={question.id}><td>{question.prompt}</td>
              <td>{question.kind === 'file' ? data.files.filter(file => file.question_id === question.id).map(file => <a key={file.id} href={`${api}files/${file.id}`}>{file.filename}</a>)
                : question.kind === 'code' ? <pre>{String(answers[question.id] ?? '—')}</pre> : shown(answers[question.id], question.kind === 'matching' ? [] : question.choices)}</td>
              {data.staff && <td>{question.answer === null || question.answer === undefined ? 'Correction humaine' : shown(question.answer as unknown, question.choices)}</td>}
              <td>{question.auto ?? '—'}</td><td>{question.points}</td></tr>)}
          </Table>
          {data.gradings.length > 0 && <>
            <h3>Corrections et commentaires</h3>
            <ul>{data.gradings.map(item => <li key={item.round}><strong>{rounds[item.round]}</strong> : {Number(item.total)} / {data.maximum}{'grader' in item && item.grader ? ` — ${item.grader}` : ''}
              {item.feedback && <p>{item.feedback}</p>}</li>)}</ul>
          </>}
        </Panel>
      )}

      {grading && (
        <Panel title={rounds[data.pending!]} id="corriger">
          <ActionForm action={api + 'grade'} back={back} hidden={{ attemptId: attempt.id, round: data.pending! }} submit="Enregistrer la correction">
            <p className="studio-wide studio-help">Les questions à correction automatique sont déjà notées ({attempt.auto_score ?? 0} pt). Notez les réponses rédigées, le code, les fichiers et la grille.</p>
            {manual.map(question => <label key={question.id}>{question.prompt.slice(0, 80)} (sur {question.points})<input name={`s.${question.id}`} inputMode="decimal" defaultValue="0" /></label>)}
            {assessment.rubric.map((row, index) => <label key={index}>{row.criterion} (sur {row.points})<input name={`c.${index}`} inputMode="decimal" defaultValue="0" /></label>)}
            <label className="studio-wide">Commentaire détaillé<textarea name="feedback" rows={4} maxLength={8000} /></label>
          </ActionForm>
        </Panel>
      )}

      {(data.cases.length > 0 || (data.staff && attempt.state === 'submitted')) && (
        <Panel title="Procédure de fraude ou de plagiat" id="fraude">
          {data.cases.map(item => (
            <section key={item.id} className="studio-panel">
              <p><Badge tone={item.state === 'sanctioned' ? 'danger' : item.state === 'dismissed' ? 'muted' : 'warn'}>{caseStates[item.state]}</Badge> — signalée le {formatTime(item.reported_at)}</p>
              <p><strong>Motif :</strong> {item.reason}</p>
              {item.learner_response && <p><strong>Observations de l’apprenant :</strong> {item.learner_response}</p>}
              {item.decision && <p><strong>Décision motivée :</strong> {item.decision}</p>}
              {data.own && item.state === 'open' && (
                <ActionForm action={api + 'respond'} back={back} hidden={{ caseId: item.id }} submit="Transmettre mes observations">
                  <label className="studio-wide">Vos observations<textarea name="response" required maxLength={4000} /></label>
                </ActionForm>
              )}
              {data.staff && data.access.integrity && ['open', 'answered'].includes(item.state) && (
                <ActionForm action={api + 'decide'} back={back} hidden={{ caseId: item.id }} submit="Décider">
                  <label>Issue<select name="outcome"><option value="dismissed">Classer sans suite</option><option value="sanctioned">Sanctionner (note annulée)</option></select></label>
                  {item.state === 'open' && <label className="studio-check"><input type="checkbox" name="noResponse" /> Constater l’absence d’observations dans le délai</label>}
                  <label className="studio-wide">Motivation<textarea name="decision" required maxLength={4000} /></label>
                </ActionForm>
              )}
            </section>
          ))}
          {data.staff && data.access.grade && attempt.state === 'submitted' && (
            <ActionForm action={api + 'report'} back={back} hidden={{ attemptId: attempt.id }} submit="Signaler une suspicion">
              <label className="studio-wide">Motif et éléments constatés<textarea name="reason" required maxLength={4000} /></label>
            </ActionForm>
          )}
        </Panel>
      )}
    </main>
  );
}
