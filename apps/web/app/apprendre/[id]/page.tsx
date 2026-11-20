import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatInZone } from '@unoa/domain/time';
import { scopeIdFormat } from '@/lib/iam/settings';
import { canModerate, canTeach, offeringView } from '@/lib/lms/offerings';
import { ActionForm, Badge, Editor, Notice, Panel, shortId, Table } from '../../administration/forms';
import { learner, refusedAs, roleLabels } from '../session';

export const metadata: Metadata = { title: 'Cours' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; message?: string }> };
const kindLabels: Record<string, string> = { page: 'Lecture', video: 'Vidéo', audio: 'Audio', document: 'Document', link: 'Ressource', activity: 'Activité' };

export default async function Offering({ params, searchParams }: Props) {
  const { id } = await params;
  if (!scopeIdFormat.test(id)) notFound();
  const { settings, actor } = await learner();
  const search = await searchParams;
  const view = await offeringView(settings, actor, id).catch(refusedAs(null));
  if (!view) {
    return <main id="contenu" className="studio"><section className="studio-panel"><h1>Cours</h1>
      <p>Vous n’êtes pas membre de cette offre.</p><p><a href="/apprendre">Mes cours</a></p></section></main>;
  }
  const { offering, version, modules, lessons, access, completed, dues, sessions, members, threads } = view;
  const back = `/apprendre/${offering.id}`;
  const teach = canTeach(offering);
  const due = new Map<string, Date>(dues.map(item => [item.lesson_id, item.due_at] as [string, Date]));
  const now = Date.now();
  const upcoming = sessions.filter(item => new Date(item.ends_at).getTime() > now);
  const past = sessions.filter(item => new Date(item.ends_at).getTime() <= now);
  const zone = offering.time_zone;
  const done = new Set(completed);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/apprendre">Mes cours</a> › <span aria-current="page">{offering.title}</span></nav>
      <section className="studio-heading">
        <p className="eyebrow">{offering.course_code} · {offering.label} · {offering.role ? roleLabels[offering.role] : 'Gestion'}</p>
        <h1>{offering.title}</h1>
        <p>Du {offering.starts_on} au {offering.ends_on} · horaires affichés en {zone}</p>
        {offering.role === 'learner' && lessons.length > 0 && (
          <div className="progress on-dark" aria-label="Progression">
            <span className="track"><i style={{ width: `${Math.round(100 * done.size / lessons.length)}%` }} /></span>
            {done.size}/{lessons.length} leçons terminées · indicatif, distinct des notes officielles
          </div>
        )}
      </section>
      <Notice error={search.error} message={search.message} />

      <Panel title="Séances en visioconférence" id="seances">
        {upcoming.length === 0 ? <p>Aucune séance à venir.</p> : upcoming.map(item => (
          <article key={item.id} className="session-card">
            <div>
              <h3>{item.title} {item.state === 'cancelled' && <Badge tone="danger">annulée</Badge>}
                {item.recording_planned && item.state !== 'cancelled' && <Badge tone="warn">enregistrement annoncé</Badge>}</h3>
              <p>{formatInZone(item.starts_at, zone)} → {new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short', timeZone: zone }).format(new Date(item.ends_at))}</p>
              {item.agenda && <p className="muted">{item.agenda}</p>}
              {item.cancel_reason && <p className="muted">Motif : {item.cancel_reason}</p>}
            </div>
            {item.state === 'scheduled' && (
              <div className="studio-actions">
                {item.recording_planned && offering.role && (
                  <>
                    <ActionForm inline action={`/api/v1/live/sessions/${item.id}/consent`} back={back} hidden={{ decision: 'granted' }}
                      submit={item.consent === 'granted' ? '✓ J’accepte l’enregistrement' : 'J’accepte l’enregistrement'} />
                    <ActionForm inline action={`/api/v1/live/sessions/${item.id}/consent`} back={back} hidden={{ decision: 'refused' }}
                      submit={item.consent === 'refused' ? '✓ Je refuse l’enregistrement' : 'Je refuse l’enregistrement'} />
                  </>
                )}
                {offering.role && (
                  <form method="post" action={`/api/v1/live/sessions/${item.id}/join`}>
                    <button className="action" type="submit">Rejoindre la séance</button>
                  </form>
                )}
              </div>
            )}
            {teach && item.state === 'scheduled' && (
              <div className="editor-grid">
                <Editor summary="Reporter">
                  <ActionForm action={`/api/v1/live/sessions/${item.id}/reschedule`} back={back} submit="Reporter et prévenir">
                    <label>Nouveau début ({zone})<input type="datetime-local" name="startsAt" required /></label>
                    <label>Durée (minutes)<input type="number" name="durationMinutes" required min={5} max={720} defaultValue={90} /></label>
                    <label className="studio-wide">Motif<input name="reason" required maxLength={500} /></label>
                  </ActionForm>
                </Editor>
                <Editor summary="Annuler">
                  <ActionForm action={`/api/v1/live/sessions/${item.id}/cancel`} back={back} submit="Annuler et prévenir"
                    confirm="L’annulation est définitive et notifiée à tous les participants.">
                    <label className="studio-wide">Motif<input name="reason" required maxLength={500} /></label>
                  </ActionForm>
                </Editor>
                {!item.recording_planned && (
                  <ActionForm action={`/api/v1/live/sessions/${item.id}/recording`} back={back} submit="Annoncer un enregistrement"
                    confirm="Chaque participant indiquera son consentement ; un refus empêche la publication du replay.">
                    <label className="studio-wide">Finalité<input name="reason" maxLength={500} /></label>
                  </ActionForm>
                )}
                <Editor summary="Partager un document">
                  <ActionForm action={`/api/v1/live/sessions/${item.id}/resources`} back={back} submit="Partager">
                    <label>Titre<input name="title" required maxLength={200} /></label>
                    <label>Adresse HTTPS<input type="url" name="url" required maxLength={2000} /></label>
                  </ActionForm>
                </Editor>
              </div>
            )}
            {item.resources.length > 0 && <ul>{item.resources.map(resource => <li key={resource.url}><a href={resource.url} rel="noopener noreferrer">{resource.title}</a></li>)}</ul>}
            {teach && <p><a href={`/apprendre/${offering.id}/seances/${item.id}`}>Présences et historique</a></p>}
          </article>
        ))}
        {teach && offering.state === 'open' && (
          <Editor summary="Planifier une séance">
            <ActionForm action={`/api/v1/live/offerings/${offering.id}/sessions`} back={back} submit="Planifier et convoquer"
              confirm="Les participants reçoivent une notification. Le lien de connexion est personnel et expire à la fin de la séance.">
              <label className="studio-wide">Titre<input name="title" required maxLength={200} /></label>
              <label>Début ({zone})<input type="datetime-local" name="startsAt" required /></label>
              <label>Durée (minutes)<input type="number" name="durationMinutes" required min={5} max={720} defaultValue={90} /></label>
              <label className="studio-wide">Ordre du jour<textarea name="agenda" maxLength={4000} /></label>
              <label className="studio-checkbox"><input type="checkbox" name="recordingPlanned" /> Annoncer un enregistrement</label>
            </ActionForm>
          </Editor>
        )}
        {past.length > 0 && (
          <details className="studio-editor"><summary>Séances passées et replays ({past.length})</summary>
            <ul>{past.map(item => (
              <li key={item.id}>{item.title} · {formatInZone(item.starts_at, zone)}
                {item.state === 'cancelled' && <Badge tone="danger">annulée</Badge>}
                {item.replay_url && <> · <a href={item.replay_url} rel="noopener noreferrer">Voir le replay</a></>}
                {teach && item.recording_planned && !item.replay_url && item.state === 'scheduled' && (
                  <ActionForm inline action={`/api/v1/live/sessions/${item.id}/replay`} back={back} submit="Publier le replay">
                    <label className="sr" htmlFor={'replay-' + item.id}>Adresse du replay</label>
                    <input id={'replay-' + item.id} type="url" name="url" required placeholder="https://…" />
                  </ActionForm>
                )}
                {teach && <> · <a href={`/apprendre/${offering.id}/seances/${item.id}`}>présences</a></>}
              </li>
            ))}</ul>
          </details>
        )}
      </Panel>

      <Panel title="Parcours" id="parcours">
        <details><summary>Syllabus</summary>
          <p>{version.objectives}</p>
          {version.prerequisites && <p><strong>Prérequis :</strong> {version.prerequisites}</p>}
          {version.methods && <p><strong>Méthodes :</strong> {version.methods}</p>}
          {version.bibliography && <p><strong>Bibliographie :</strong> {version.bibliography}</p>}
        </details>
        {modules.map(module => (
          <section key={module.id} className="period">
            <h3>{module.ordinal}. {module.title} {module.access_mode === 'sequential' && <Badge tone="info">dans l’ordre</Badge>}</h3>
            <ol className="lesson-list">
              {lessons.filter(lesson => lesson.module_id === module.id).map(lesson => {
                const state = access[lesson.id];
                return (
                  <li key={lesson.id} className={done.has(lesson.id) ? 'done' : undefined}>
                    {state?.open ? <a href={`/apprendre/${offering.id}/lecon/${lesson.id}`}>{lesson.title}</a>
                      : <span aria-disabled="true">🔒 {lesson.title}</span>}
                    {' '}<Badge tone="muted">{kindLabels[lesson.kind]}</Badge>
                    {done.has(lesson.id) && <Badge tone="ok">terminée</Badge>}
                    {due.has(lesson.id) && <Badge tone="warn">échéance {formatInZone(due.get(lesson.id)!, zone)}</Badge>}
                    {!state?.open && <span className="muted"> {state && 'reason' in state && state.reason === 'condition' ? 'après la leçon requise' : 'après les leçons précédentes'}</span>}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
        {teach && lessons.length > 0 && (
          <Editor summary="Fixer une échéance">
            <ActionForm action={`/api/v1/lms/offerings/${offering.id}/dues`} back={back} submit="Enregistrer">
              <label>Leçon ou activité<select name="lessonId">{lessons.map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}</select></label>
              <label>Échéance ({zone})<input type="datetime-local" name="dueAt" required /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Forum du cours" id="forum">
        {threads.length === 0 ? <p>Aucune discussion.</p> : (
          <ul>{threads.map(thread => (
            <li key={thread.id}><a href={`/apprendre/${offering.id}/forum/${thread.id}`}>{thread.title}</a>
              <span className="muted"> · {thread.posts} message(s)</span>{thread.locked_at && <Badge tone="muted">verrouillée</Badge>}</li>
          ))}</ul>
        )}
        {offering.role && offering.state === 'open' && (
          <Editor summary="Ouvrir une discussion">
            <ActionForm action={`/api/v1/lms/offerings/${offering.id}/threads`} back={back} submit="Publier">
              <label className="studio-wide">Sujet<input name="title" required maxLength={200} /></label>
              <label className="studio-wide">Message<textarea name="body" required maxLength={10000} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      {canModerate(offering) && (
        <Panel title="Participants" id="participants">
          <Table label="Participants" head={['Personne', 'Rôle', 'Action']}>
            {members.map(member => (
              <tr key={member.account_id + member.role}>
                <td>{member.display_name ?? 'Compte ' + shortId(member.account_id)}</td><td>{roleLabels[member.role]}</td>
                <td>{offering.manage && <ActionForm inline action={`/api/v1/lms/offerings/${offering.id}/members`} back={back}
                  hidden={{ accountId: member.account_id, role: member.role, remove: 'true' }} submit="Retirer" />}</td>
              </tr>
            ))}
          </Table>
          {offering.manage && offering.state === 'open' && (
            <Editor summary="Inscrire un participant">
              <ActionForm action={`/api/v1/lms/offerings/${offering.id}/members`} back={back} submit="Inscrire">
                <label>Identifiant du compte<input name="accountId" required pattern="[0-9a-fA-F\-]{36}" /></label>
                <label>Rôle<select name="role">{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="studio-wide">Nom affiché<input name="displayName" maxLength={160} /></label>
              </ActionForm>
            </Editor>
          )}
          {offering.manage && offering.state === 'open' && (
            <ActionForm action={`/api/v1/lms/offerings/${offering.id}/close`} back={back} submit="Clore l’offre"
              confirm="Une offre close ne rouvre pas ; l’historique reste consultable." />
          )}
        </Panel>
      )}
    </main>
  );
}
